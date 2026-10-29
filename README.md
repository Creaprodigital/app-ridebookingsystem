# SharedRide Driver

Application mobile chauffeur (Expo / React Native) dans `frontend/`.

## Générer l'application

### Android (APK) — automatique, sans compte Expo

Le workflow **Android APK** (`.github/workflows/android-apk.yml`) compile un APK
installable à chaque push sur `main` (ou une branche `claude/**`) qui modifie `frontend/`.
On peut aussi le lancer à la main : onglet **Actions** > **Android APK** > **Run workflow**.

L'APK se télécharge dans la page du run, section **Artifacts** (conservé 30 jours).
Sur le téléphone, autorisez l'installation depuis des sources inconnues.

> Cet APK est signé avec la clé de debug d'Expo : parfait pour tester et distribuer
> directement, mais pas pour le Play Store (utilisez le profil `production` d'EAS ci-dessous).

### iOS (et Android pour les stores) — via Expo EAS

Linux ne peut pas compiler iOS : le build se fait dans le cloud d'Expo.

1. Créez un compte sur https://expo.dev, puis un token : *Account settings > Access tokens*.
2. Sur GitHub : *Settings > Secrets and variables > Actions* > ajoutez le secret `EXPO_TOKEN`.
3. Le `projectId` dans `frontend/app.json` (`extra.eas.projectId`) doit appartenir à votre
   compte Expo. Sinon, lancez une fois `npx eas-cli init` dans `frontend/` (ou créez le projet
   sur expo.dev) et remplacez l'ID.
4. iOS nécessite un compte Apple Developer (99 $/an). La première fois, lancez
   `npx eas-cli build -p ios --profile preview` depuis un ordinateur (Windows, Mac ou Linux)
   pour qu'EAS crée les certificats et enregistre vos iPhones de test
   (`npx eas-cli device:create`). Ensuite, le workflow peut tourner seul.
5. Onglet **Actions** > **EAS Build (iOS / Android)** > **Run workflow** : choisissez la
   plateforme et le profil. Le lien de téléchargement / d'installation apparaît sur expo.dev.

Profils (`frontend/eas.json`) :

| Profil       | Android            | iOS                                  |
|--------------|--------------------|--------------------------------------|
| `preview`    | APK installable    | installation sur iPhones enregistrés |
| `production` | AAB pour Play Store| build App Store / TestFlight         |

L'URL du backend et la clé Google Maps intégrées à l'app sont dans `build.base.env`
de `frontend/eas.json` (utilisées aussi par le workflow APK).

## Développer en local

```bash
cd frontend
yarn install
npx expo start
```
