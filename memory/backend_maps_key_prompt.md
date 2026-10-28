# PROMPT BACKEND — Clé Google Maps du professionnel pour l'app mobile

Objectif : quand un **dispatcheur professionnel** (role `pro`) ou un **chauffeur lié à ce professionnel** se connecte à l'app mobile RideBookingSystem, l'app doit utiliser **la clé Google Maps du professionnel** (celle enregistrée dans Paramètres → Google Maps, `tenant.config.google_maps_api_key`) pour afficher la carte (Maps JavaScript API) et calculer les tracés (Directions API).

Aujourd'hui, `/api/auth/me` et `/api/pro/maps-config` ne renvoient qu'une version masquée (`google_maps_api_key_set: true`, `key_mask`). L'app utilise donc une clé de secours. Ne PAS modifier ces endpoints (le masquage est correct) : ajouter un endpoint dédié.

## NOUVEAU — `GET /api/maps/client-key`
- Auth : Bearer token obligatoire (401 sinon).
- Autorisé pour :
  - un utilisateur `role = "pro"` → clé de SON tenant ;
  - un chauffeur (`role = "driver"`) rattaché à un tenant (`tenant_id` du chauffeur) → clé de CE tenant.
  - Tout autre rôle → 403.
- Réponse 200 :
```json
{ "google_maps_api_key": "AIza…", "country": "fr", "tenant_id": "…" }
```
- Si le tenant n'a pas de clé : `200 { "google_maps_api_key": null }` (l'app garde sa clé de secours).
- Ne jamais renvoyer d'autres secrets dans cette réponse.
- Header `Cache-Control: no-store`.

## Recommandations Google Cloud (à communiquer au professionnel)
Cette clé est utilisée côté app (navigateur / téléphone), elle doit donc être **restreinte** dans Google Cloud Console :
- Restriction d'API : Maps JavaScript API, Directions API, Places API uniquement.
- Restriction d'application : référents HTTP (domaine de l'app déployée) et/ou apps Android/iOS (package `…`, bundle id).
- Garder une clé serveur distincte (non exposée) pour le calcul des prix si possible.

## Tests attendus
- Pro connecté → 200 avec la clé en clair de son tenant.
- Chauffeur lié au tenant → 200 avec la même clé.
- Chauffeur d'un autre tenant → clé de son propre tenant uniquement.
- Sans token → 401. Tenant sans clé → `google_maps_api_key: null`.
