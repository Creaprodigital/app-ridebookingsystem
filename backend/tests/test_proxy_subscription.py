"""Backend proxy + driver subscription endpoint tests.

Tests the local FastAPI transparent proxy at http://localhost:8001 which
forwards /api/* to the upstream SaaS backend.
"""
import os
import pytest
import requests

# Local proxy base — this is what the frontend ultimately uses once the
# Emergent publish pipeline rewrites EXPO_PUBLIC_BACKEND_URL.
LOCAL = "http://localhost:8001"
DRIVER_EMAIL = "hoppla.me@gmail.com"
DRIVER_PASSWORD = "123456789"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def driver_token(client):
    r = client.post(f"{LOCAL}/api/auth/login",
                    json={"email": DRIVER_EMAIL, "password": DRIVER_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    assert "user" in data
    assert data["user"]["role"] == "driver"
    return data["token"]


# ----- Health probes -----
class TestHealth:
    def test_health_endpoint(self, client):
        r = client.get(f"{LOCAL}/health")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["mongo"] is True
        assert "upstream" in body and body["upstream"].startswith("https://")

    def test_healthz_endpoint(self, client):
        r = client.get(f"{LOCAL}/healthz")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_api_status_short_circuit(self, client):
        r = client.get(f"{LOCAL}/api/status")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["service"] == "ridebookingsystem"


# ----- Auth proxy -----
class TestAuthProxy:
    def test_driver_login_returns_jwt(self, driver_token):
        # JWT has three dot-separated segments
        assert driver_token.count(".") == 2
        assert len(driver_token) > 50

    def test_wrong_password_returns_401(self, client):
        r = client.post(f"{LOCAL}/api/auth/login",
                        json={"email": DRIVER_EMAIL, "password": "wrong"})
        assert r.status_code == 401


# ----- Driver subscription endpoints -----
class TestDriverSubscription:
    def test_get_subscription_state(self, client, driver_token):
        r = client.get(f"{LOCAL}/api/driver/subscription",
                       headers={"Authorization": f"Bearer {driver_token}"})
        assert r.status_code == 200
        body = r.json()
        # Required fields on the contract
        for key in ("enabled", "status", "monthly_amount_cents",
                    "next_billing_at", "last_paid_at", "last_failure_reason"):
            assert key in body, f"Missing key: {key}"
        assert isinstance(body["enabled"], bool)
        assert isinstance(body["monthly_amount_cents"], int)
        # Credentials file states the current driver has status=active
        assert body["enabled"] is True
        assert body["status"] == "active"
        assert body["monthly_amount_cents"] == 5000

    def test_checkout_returns_stripe_url(self, client, driver_token):
        r = client.post(
            f"{LOCAL}/api/driver/subscription/checkout",
            headers={"Authorization": f"Bearer {driver_token}"},
            json={"origin_url": "https://ride-share-app-171.preview.emergentagent.com"},
        )
        assert r.status_code == 200, f"checkout failed: {r.status_code} {r.text}"
        body = r.json()
        assert "url" in body and body["url"].startswith("https://checkout.stripe.com/")
        assert "session_id" in body
        assert body.get("amount_cents") == 5000

    def test_checkout_requires_auth(self, client):
        r = client.post(
            f"{LOCAL}/api/driver/subscription/checkout",
            json={"origin_url": "https://example.com"},
        )
        # Expect 401/403 — must NOT be 404 ("endpoint non disponible")
        assert r.status_code in (401, 403), f"Expected auth error, got {r.status_code}"

    def test_portal_endpoint_reachable(self, client, driver_token):
        """Portal endpoint should be reachable — may 400 for test account
        that was marked active without a real Stripe sub (per credentials.md)."""
        r = client.post(
            f"{LOCAL}/api/driver/subscription/portal",
            headers={"Authorization": f"Bearer {driver_token}"},
            json={"origin_url": "https://example.com"},
        )
        assert r.status_code != 404, "Portal endpoint should exist (not 404)"
        assert r.status_code in (200, 400), f"Unexpected status: {r.status_code} {r.text}"
