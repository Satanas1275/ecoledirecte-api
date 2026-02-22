# ED API Client (EcoleDirecte)

Client Node.js (ESM) pour automatiser l'auth EcoleDirecte et récupérer:

- login/account
- emploi du temps
- cahier de texte
- notes
- messages (liste)
- message précis (par `id`)

Le projet expose:

1. Un **module réutilisable**: `edapi-client.js`
2. Un **runner CLI**: `index.js` (piloté par variables d'environnement)

## Installation

```bash
npm install
```

## Utilisation rapide (CLI)

Le script principal est `index.js`.

### Variables obligatoires

- `ED_USER`: identifiant EcoleDirecte
- `ED_PASS`: mot de passe EcoleDirecte

### Variables optionnelles

- `ED_FETCH`: sections à récupérer (liste séparée par virgules)
  - valeurs possibles: `login,timetable,cahierDeTexte,notes,messages,message`
  - défaut si absent: `login,timetable,cahierDeTexte,notes,messages`
- `ED_QCM_CHOICE`: réponse QCM si 2FA/QCM (index 1-based, valeur décodée ou base64)
- `ED_START_DATE`: date début EDT (`YYYY-MM-DD`)
- `ED_END_DATE`: date fin EDT (`YYYY-MM-DD`)
- `ED_MESSAGE_ID`: id du message à récupérer (obligatoire si `ED_FETCH` contient `message`)
- `ED_MESSAGE_MODE`: `destinataire` (défaut) ou `expediteur`
- `ED_ANNEE_MESSAGES`: année messagerie (défaut `2025-2026`)
- `ED_MESSAGES_LIMIT`: nombre de messages dans la liste `messages` (défaut `100`)

### Exemples

Récupérer tout (sauf message unique):

```bash
ED_USER="..." ED_PASS="..." npm start
```

Récupérer uniquement un message (`id=11780`):

```bash
ED_USER="..." ED_PASS="..." ED_FETCH="message" ED_MESSAGE_ID="11780" npm start
```

Récupérer liste des messages + un message précis:

```bash
ED_USER="..." ED_PASS="..." ED_FETCH="messages,message" ED_MESSAGE_ID="11780" npm start
```

Récupérer uniquement 1 message dans la liste inbox (le plus récent):

```bash
ED_USER="..." ED_PASS="..." ED_FETCH="messages" ED_MESSAGES_LIMIT="1" npm start
```

## Sortie JSON

`index.js` affiche un JSON unique en stdout, avec uniquement les sections demandées.

Exemple:

```json
{
  "login": { "code": 200, "data": { "accounts": [] } },
  "notes": { "code": 200, "data": {} },
  "message": { "code": 200, "data": { "id": 11780 } }
}
```

## Utilisation en module (dans un autre projet)

Tu peux importer `edapi-client.js` directement.

```js
import { EcoleDirecteClient } from "./edapi-client.js";

const api = new EcoleDirecteClient();

const loginRes = await api.login("USER", "PASS", async ({ rawPropositions }) => {
  // Exemple: choix auto 1re proposition en cas QCM
  return rawPropositions[0];
});

if (loginRes.code !== 200) {
  console.log(loginRes);
  process.exit(1);
}

const studentId = loginRes.data.accounts.find(a => a.typeCompte === "E")?.id;
const notes = await api.fetchNotes(studentId);
console.log(notes);
```

## API du module

### `new EcoleDirecteClient()`

Crée un client avec cookie jar + gestion automatique des tokens `X-Token` / `2fa-Token`.

### `login(identifiant, motdepasse, getQcmChoice)`

- `identifiant: string`
- `motdepasse: string`
- `getQcmChoice: ({ rawQuestion, rawPropositions, question, propositions }) => Promise<string>`

Retourne la réponse `login.awp` complète.

### `fetchTimetable(studentId, dateDebut, dateFin)`

- Endpoint: `/v3/E/{id}/emploidutemps.awp?verbe=get&v=4.95.2`
- Payload: `{ dateDebut, dateFin, avecTrous: false }`

### `fetchCahierDeTexte(studentId)`

- Endpoint: `/v3/Eleves/{id}/cahierdetexte.awp?verbe=get&v=4.95.2`
- Payload: `{}`

### `fetchNotes(studentId, anneeScolaire = "")`

- Endpoint: `/v3/eleves/{id}/notes.awp?verbe=get&v=4.95.2`
- Payload: `{ anneeScolaire: "" }`

### `fetchMessages(studentId, options = {})`

- Endpoint: `/v3/eleves/{id}/messages.awp?...&verbe=get&v=4.95.2`
- Paramètres query alignés front, configurables via `options`:
  - `anneeMessages` (défaut: `2025-2026`)
  - `typeRecuperation` (défaut: `received`)
  - `page` (défaut: `0`)
  - `itemsPerPage` (défaut: `100`)
  - `getAll` (défaut: `0`)
  - `force` (défaut: `false`)
  - `idClasseur` (défaut: `0`)
  - `orderBy` (défaut: `date`)
  - `order` (défaut: `desc`)
  - `query` (défaut: `""`)
  - `onlyRead` (défaut: `""`)
- Payload: `{ anneeMessages }`

### `fetchMessage(studentId, messageId, mode = "destinataire", anneeMessages = "2025-2026")`

- Endpoint: `/v3/eleves/{id}/messages/{messageId}.awp?verbe=get&mode={mode}&v=4.95.2`
- Payload: `{ anneeMessages }`

### Helpers exportés

- `decodeBase64(value)`
- `toEdDate(date)`

## Notes importantes

- Le contenu de certains champs ED est encodé en base64 (ex: contenu de message, appréciations).
- Le projet est en ESM (`"type": "module"`).
- Ne commit jamais tes identifiants/mots de passe.

## Utiliser seulement le module (sans `index.js`)

Si tu veux remplacer complètement `index.js`, garde juste `edapi-client.js` et fais ton script perso:

```js
import { EcoleDirecteClient } from "./edapi-client.js";

const api = new EcoleDirecteClient();
const loginRes = await api.login(process.env.ED_USER, process.env.ED_PASS, async ({ rawPropositions }) => {
  // QCM: ici tu choisis la proposition voulue
  return rawPropositions[0];
});

if (loginRes.code !== 200) {
  console.log(loginRes);
  process.exit(1);
}

const studentId = loginRes.data.accounts.find(a => a.typeCompte === "E")?.id;

// 1 message inbox
const inbox = await api.fetchMessages(studentId, { itemsPerPage: 1 });

// message précis
const message = await api.fetchMessage(studentId, 11780, "destinataire", "2025-2026");

console.log({ inbox, message });
```
