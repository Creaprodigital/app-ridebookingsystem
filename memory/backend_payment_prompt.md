# PROMPT BACKEND — Sécurisation des paiements en fin de course (RideBookingSystem)

Contexte : l'application mobile Chauffeur doit afficher, à la fin de chaque course, UNE seule consigne de paiement fiable :
- 🟢 VERT : DÉJÀ PAYÉ – NE RIEN ENCAISSER
- 🟠 ORANGE : ESPÈCES (ou CARTE À BORD) – ENCAISSER XX,XX €
- 🔴 ROUGE : PAIEMENT NON CONFIRMÉ – CONTACTER LE DISPATCHEUR

Aujourd'hui le backend ne fournit au chauffeur que `payment_method` (`online` / `cash_onboard` / `card_onboard`) et `payment_status` (toujours `pending`, même pour des courses payées en ligne). `/public/payment/status/{id}` attend un ID de session Stripe, pas un ID de course. Il manque donc les éléments ci-dessous. **Ne rien casser des endpoints existants.**

## 1. Statut de paiement séparé du statut de course
- Ajouter sur chaque booking un sous-objet `payment` (ou des champs équivalents) :
  - `amount_total` (prix final de la course, en euros)
  - `amount_paid` (somme réellement encaissée : Stripe confirmé + encaissements déclarés)
  - `amount_due` = `max(0, amount_total - amount_paid)` (calcul serveur, arrondi à 2 décimales)
  - `payment_status` ∈ `pending` | `paid` | `partially_paid` | `failed` | `refunded`
  - `payment_issue_open` (bool)
- `PATCH /api/driver/missions/{id}/status` avec `completed` **ne doit JAMAIS** modifier le statut de paiement. Une course peut être `completed` avec un paiement `pending`.
- Le paiement en ligne n'est `paid` que s'il est **vérifié auprès de Stripe** (webhook `checkout.session.completed` / `payment_intent.succeeded`, ou récupération de la session/PaymentIntent côté serveur avec la clé du tenant). Jamais sur la seule base de `payment_method`.

## 2. NOUVEAU — `GET /api/driver/missions/{mission_id}/payment`
Auth : chauffeur assigné à la course uniquement (sinon 403). Re-vérifie Stripe en direct si le paiement est en ligne et pas encore `paid`.
Réponse :
```json
{
  "booking_id": "…",
  "payment_method": "online | cash_onboard | card_onboard",
  "payment_status": "pending | paid | partially_paid | failed | refunded",
  "amount_total": 85.0,
  "amount_paid": 0.0,
  "amount_due": 85.0,
  "currency": "EUR",
  "display_case": "paid_online | collect_cash | collect_card | unconfirmed",
  "can_collect": true,
  "collection": null,
  "payment_issue_open": false,
  "checked_at": "2026-06-20T12:30:00Z"
}
```
Règles de `display_case` (calculées UNIQUEMENT par le serveur) :
- `paid_online` : `amount_due == 0` et paiement confirmé (Stripe ou encaissement déjà déclaré). `can_collect = false`.
- `collect_cash` : méthode `cash_onboard` et `amount_due > 0`. `can_collect = true`.
- `collect_card` : méthode `card_onboard` et `amount_due > 0`. `can_collect = true`.
- `unconfirmed` : méthode `online` et Stripe non confirmé / échoué / partiel. `can_collect = false` (aucun encaissement chauffeur possible sans procédure dispatcheur).
- Paiement partiel (ex. acompte en ligne + solde à bord) : `amount_due` = solde réel restant ; jamais le total.
- `collection` : si déjà encaissé, renvoyer `{ "driver_id", "driver_name", "amount", "method": "cash|card", "confirmation_mode": "slide", "collected_at" }` et `can_collect = false`.

## 3. NOUVEAU — `POST /api/driver/missions/{mission_id}/payment/collect`
Body :
```json
{ "method": "cash | card", "amount": 85.0, "confirmation_mode": "slide", "idempotency_key": "uuid-v4" }
```
Contrôles serveur obligatoires :
- Chauffeur = chauffeur assigné (403 sinon).
- `display_case` doit être `collect_cash` ou `collect_card` et correspondre à `method` (422 sinon).
- `amount` doit être **exactement** égal à `amount_due` calculé par le serveur (422 sinon). Montant verrouillé : le serveur ne fait jamais confiance au montant du client.
- Déjà encaissé ou `amount_due == 0` → **409** `{ "detail": "Paiement déjà encaissé" }`.
- Idempotence : même `idempotency_key` → renvoyer la même réponse (200) sans créer de 2e encaissement. Utiliser une opération atomique (`find_one_and_update` avec condition `amount_due > 0`) pour éviter les doubles validations simultanées.
- Effet : `amount_paid += amount`, `amount_due = 0`, `payment_status = "paid"`, champ `collection` rempli. NE PAS changer le statut de course.
- Traçabilité : insérer un document dans une nouvelle collection `payment_events` :
  `{ id, tenant_id, booking_id, driver_id, type: "driver_collect", method, amount, currency, confirmation_mode, idempotency_key, created_at, ip, user_agent }`
- Réponse 200 : le même objet que le `GET …/payment` mis à jour.

## 4. NOUVEAU — `POST /api/driver/missions/{mission_id}/payment/issue`
Body : `{ "reason": "online_not_confirmed | client_refuses | amount_dispute | other", "comment": "texte libre optionnel" }`
- Chauffeur assigné uniquement.
- Crée un document `payment_issues` `{ id, tenant_id, booking_id, driver_id, reason, comment, status: "open", created_at, resolved_at: null, resolved_by: null, resolution: null }`.
- Met `payment_issue_open = true` sur la course + événement `payment_events` type `driver_issue`.
- Notifie immédiatement le(s) dispatcheur(s) du tenant (notification Pro existante + push Pro) : « ⚠️ Problème de paiement signalé – course #xxxx ».
- Réponse 201 avec l'objet issue. Si une issue est déjà ouverte : renvoyer l'existante (200), pas de doublon.

## 5. Côté Dispatcheur / Espace Pro
- `GET /api/pro/bookings` et `GET /api/pro/bookings/{id}` : inclure `amount_total`, `amount_paid`, `amount_due`, `payment_status`, `collection`, `payment_issue_open` et la dernière issue.
- NOUVEAU `GET /api/pro/payment-issues?status=open` : liste des problèmes de paiement du tenant.
- NOUVEAU `POST /api/pro/bookings/{id}/payment/resolve`
  Body : `{ "action": "recheck_stripe | mark_paid | mark_collected | waive | send_payment_link", "amount": 85.0, "note": "…" }`
  - `recheck_stripe` : re-interroge Stripe et met à jour le statut.
  - `mark_paid` / `mark_collected` : validation manuelle par le dispatcheur (tracée dans `payment_events` type `pro_resolve` avec `pro_user_id`).
  - `waive` : abandon de créance (tracé).
  - `send_payment_link` : crée une session Stripe Checkout pour `amount_due` et l'envoie au client.
  - Ferme l'issue ouverte (`status: "resolved"`, `resolved_by`, `resolved_at`, `resolution`).
- Synchronisation : toute modification (collect / issue / resolve / webhook Stripe) doit être visible immédiatement par l'app Chauffeur (via `GET …/payment` et `/driver/missions`), l'app Dispatcheur et l'espace Pro web (+ notification Pro).

## 6. Sécurité (à corriger en même temps — URGENT)
- `GET /api/auth/me` (et la réponse de login) renvoie `tenant.payment_config.stripe.secret_key` (clé `sk_live_…`) au client. **Retirer toutes les clés secrètes (Stripe secret, webhook secret, etc.) des réponses API**, puis **régénérer la clé Stripe** dans le dashboard Stripe.

## 7. Tests attendus
- Course `online` payée Stripe → `display_case = paid_online`, `amount_due = 0`, `collect` → 409.
- Course `online` non payée → `unconfirmed`, `collect` → 422, `issue` → 201 + notification Pro.
- Course `cash_onboard` 85 € → `collect_cash`, `collect` avec 80 € → 422, avec 85 € → 200, 2e appel → 409, même `idempotency_key` → 200 identique.
- Course `card_onboard` → `collect_card`.
- Acompte 20 € en ligne sur 85 € cash → `amount_due = 65`.
- Passer une course en `completed` ne change pas `payment_status`.
- Un autre chauffeur → 403 sur les 3 endpoints.
