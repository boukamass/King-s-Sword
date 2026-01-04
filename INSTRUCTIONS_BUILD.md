
# 🚀 Guide de Compilation et Mise à jour : King's Sword

Ce guide vous explique comment compiler votre application et comment envoyer des mises à jour à vos utilisateurs.

---

## 📦 Étape 1 : Prérequis pour la distribution

1.  **GitHub Repository** : Créez un dépôt public sur GitHub pour votre projet.
2.  **Identifiants dans package.json** :
    - Remplacez `VOTRE_NOM_UTILISATEUR_GITHUB` par votre pseudo GitHub.
    - Remplacez `NOM_DU_DEPOT_GITHUB` par le nom du dépôt.
3.  **Token GitHub (GH_TOKEN)** :
    - Allez dans GitHub -> Settings -> Developer Settings -> Personal Access Tokens -> Tokens (classic).
    - Générez un token avec les droits `repo`.
    - Ajoutez-le à votre environnement ou tapez-le lors du build si demandé.

---

## 🛠️ Étape 2 : Première compilation (Installation)

1.  Assurez-vous que `public/library.json` et `public/icon.ico` sont présents.
2.  Lancez la commande :
    ```bash
    npm run electron:build
    ```
3.  L'installateur se trouve dans le dossier `release/`.

---

## 🔄 Étape 3 : Envoyer une Mise à Jour (Update)

Quand vous avez fait des modifications et que vous voulez les envoyer à tous vos utilisateurs :

1.  **Changer la version** : Dans le fichier `package.json`, augmentez le numéro de version (ex: passez de `1.0.1` à `1.0.2`).
2.  **Publier sur GitHub** : Lancez la commande suivante :
    ```bash
    npm run publish
    ```
    *Cette commande va builder l'app et envoyer automatiquement les fichiers vers un nouveau "Draft Release" sur votre GitHub.*
3.  **Finaliser sur GitHub** :
    - Allez sur votre dépôt GitHub -> **Releases**.
    - Éditez le brouillon (Draft), ajoutez une description et cliquez sur **"Publish Release"**.

---

## 🛰️ Étape 4 : Côté Utilisateur

Une fois la version publiée sur GitHub :
1.  L'utilisateur lance son application King's Sword.
2.  L'app détecte la version `1.0.2` sur GitHub.
3.  Elle télécharge le patch en arrière-plan.
4.  Une barre bleue apparaît en haut de l'écran disant : **"Mise à jour prête"**.
5.  L'utilisateur clique sur **"Installer"**, l'app redémarre et il possède la nouvelle version !

---

### ⚠️ Notes importantes sur Windows
Sans certificat de signature payant (EV Cert), Windows affichera un message **"SmartScreen"** (Écran bleu) au premier lancement de l'installateur. L'utilisateur doit cliquer sur *"Informations complémentaires"* puis *"Exécuter quand même"*. C'est normal pour les logiciels indépendants.
