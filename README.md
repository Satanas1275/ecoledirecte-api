# ED API Client (EcoleDirecte)

Client Node.js (ESM) pour automatiser l'auth EcoleDirecte et récupérer:

- login/account
- emploi du temps
- cahier de texte
- notes
- messages (liste)
- message précis (par `id`)
- cloud (fichiers)
- commandes passées (cafétéria)

Le projet expose:

1. Un **module réutilisable**: `edapi-client.js`
2. Un **runner CLI**: `index.js` (piloté par variables d'environnement)

## Installation

```bash
npm install
```

## Utilisation rapide (CLI)

Le script principal est `index.js`. Il n'affiche **que** ce que tu demandes.

### Variables obligatoires

- `ED_USER`: identifiant EcoleDirecte
- `ED_PASS`: mot de passe EcoleDirecte

### Flags de sections

Seules les sections demandées sont récupérées et affichées:

| Flag | Section |
| --- | --- |
| `--edt` / `--timetable` | emploi du temps |
| `--cdt` / `--cahier-de-texte` | cahier de texte |
| `--notes` | notes |
| `--messages` | liste des messages |
| `--message` | message précis |
| `--cloud` | cloud (fichiers) |
| `--commandes` | commandes passées (cafétéria) |
| `--download <type>:<id>` | télécharge un fichier |
| `--session` | session exportée |
| `--help` | aide |

`--download` prend un type et un id (`PIECE_JOINTE:9780`, `CLOUD:05CLOUD09...`, `FICHIER_CDT:8651`, …). Seul `--download` spécifié = seule section exécutée.

Sans flag, la valeur de `ED_FETCH` est utilisée (défaut: `cdt,notes,messages,message,cloud,commandes`).

### Flags d'options

Chaque option existe aussi en variable d'environnement (la variable est utilisée si le flag est absent):

| Flag | Env | Défaut |
| --- | --- | --- |
| `--message-id <id>` | `ED_MESSAGE_ID` | `11780` |
| `--message-mode <mode>` | `ED_MESSAGE_MODE` | `destinataire` |
| `--annee-messages <YYYY-YYYY>` | `ED_ANNEE_MESSAGES` | `2025-2026` |
| `--messages-limit <n>` | `ED_MESSAGES_LIMIT` | `100` |
| `--start-date <YYYY-MM-DD>` | `ED_START_DATE` | (requis pour `--edt`) |
| `--end-date <YYYY-MM-DD>` | `ED_END_DATE` | (requis pour `--edt`) |
| `--cloud-type <W\|E>` | `ED_CLOUD_TYPE` | `W` |
| `--cloud-depth <n>` | `ED_CLOUD_DEPTH` | `100` |
| `--cloud-id <id>` | `ED_CLOUD_ID` | premier compte élève |
| `--cloud-folder <chemin>` | `ED_CLOUD_FOLDER` | `""` |
| `--download-name <nom>` | `ED_DOWNLOAD_NAME` | nom serveur (`content-disposition`) |
| `--download-year <YYYY-YYYY>` | `ED_DOWNLOAD_YEAR` | `""` |

Auth: `ED_QCM_CHOICE` (réponse QCM, sinon prompt interactif).

### Exemples

Cloud uniquement:

```bash
ED_USER="..." ED_PASS="..." node index.js --cloud
```

Cloud d'un dossier précis (l'id d'entité cloud peut différer de l'id du compte élève):

```bash
ED_USER="..." ED_PASS="..." node index.js --cloud --cloud-id=1036 --cloud-folder='\Français\OE1'
```

Notes + messages:

```bash
ED_USER="..." ED_PASS="..." node index.js --notes --messages
```

EDT sur 1 semaine:

```bash
ED_USER="..." ED_PASS="..." node index.js --edt --start-date=2026-09-07 --end-date=2026-09-13
```

Un message précis:

```bash
ED_USER="..." ED_PASS="..." node index.js --message --message-id=11780
```

Télécharger une pièce jointe d'un message (`id` trouvé dans la liste `--messages`):

```bash
ED_USER="..." ED_PASS="..." node index.js --download PIECE_JOINTE:9780 --download-name BACpro-1eres-CIEL.jpg
```

Équivalent via `ED_FETCH` (liste séparée par virgules):

```bash
ED_USER="..." ED_PASS="..." ED_FETCH="messages,message" ED_MESSAGE_ID="11780" npm start
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

### `fetchCommandesPassage(studentId)`

Récupère les commandes passées à la caféteria (historique + points de passage + créneaux).

- `studentId`: id du compte élève (`typeCompte === "E"`)
- Endpoint: `/v3/E/{id}/commandesPassage.awp?verbe=get&v=4.95.2`
- Payload: `{}` (vide, comme le front)
- Réponse: `data.historiqueCommandes` (ex `{ idCommande, numeroCommande, creneau, date, articles, pointDePassage }`), `data.tabPointsDePassage`, `data.creneaux`, `data.joursFeries`

> Passer une commande (`v3/.../commandesPassage.awp?verbe=post`) nécessite d'abord `commandesPassage/pointsDePassage/{id}/{date}.awp?verbe=get` pour récupérer les menus du jour, puis un POST volumineux (panier complet) — plus complexe, non implémenté pour l'instant.

### `fetchCloud(entityId, options = {})`

Récupère l'arborescence des fichiers du cloud.

- `entityId`: id de l'**entité cloud** (`W/1036`), **différent** de l'id du compte élève (ex `6928`) — à passer via `--cloud-id` / `ED_CLOUD_ID` si `--cloud` échoue
- `options.type`: `W` (espace de travail / cloud de l'utilisateur connecté, défaut) ou `E` (élève précis)
- `options.profondeur`: profondeur des dossiers chargés (défaut `100`)
- `options.folder`: dossier relatif pour naviguer (défaut `""`), ex `\Français\OE1` → ajoute `&idFolder={folder}`
- Endpoint: `/v3/cloud/{type}/{entityId}.awp?verbe=get[&idFolder=...]&v=4.95.2`
- Payload: `{ profondeur }`

La réponse contient une arborescence de nœuds `folder`/`file` (`libelle`, `date`, `taille`, `id`, `children`…). Pour télécharger un fichier, récupère son `id` (chemin complet) et passe-le à `downloadFile`.

> Note: `type` `W` correspond à l'« espace de travail » de l'utilisateur connecté (c'est ce que le front officiel utilise pour `Mon Cloud`). Pour un élève précis, `E` est le type documenté. Le CLI `--cloud` essaie les deux automatiquement.

### `downloadFile(fileId, options = {})`

Télécharge n'importe quel fichier et retourne `{ buffer, filename }` (`filename` = nom serveur extrait de `content-disposition`, ex `Act_1.pdf`, ou `""`).

- `fileId`: chemin (`id` d'un nœud `file` du cloud) ou id du fichier (`id` d'une `PIECE_JOINTE` dans un message, `id` d'un devoir…)
- `options.type`: type de ressource (défaut `CLOUD`; peut être `PIECE_JOINTE`, `FICHIER_CDT`, `FICHIER_MENU_RESTAURATION`…)
- `options.year`: année scolaire si pièce jointe archivée (ex `2025-2026`)
- Endpoint: `/v3/telechargement.awp?verbe=get&fichierId={id}&leTypeDeFichier={type}&v=4.95.2`
- Payload: `{ forceDownload: 0 }`

Le CLI enregistre le fichier sous `--download-name`, sinon sous le nom serveur (`filename`), sinon le dernier segment du chemin. `downloadCloudFile(fileId, options)` est conservé comme alias de `downloadFile`.

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
