import { EcoleDirecteClient } from "./edapi-client.js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFile } from "node:fs/promises";

const SECTION_ALIASES = {
  edt: "edt",
  timetable: "edt",
  cdt: "cdt",
  cahierdetexte: "cdt",
  cahierdtexte: "cdt",
  notes: "notes",
  messages: "messages",
  message: "message",
  cloud: "cloud",
  download: "download",
  session: "session"
};

const ALL_SECTIONS = Object.keys(SECTION_ALIASES);
const BOOL_FLAGS = new Set([
  "--edt",
  "--timetable",
  "--cdt",
  "--cahier-de-texte",
  "--cahierdetexte",
  "--notes",
  "--messages",
  "--message",
  "--cloud",
  "--session",
  "--help",
  "-h"
]);

function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  const unknown = [];

  for (let i = 2; i < argv.length; i++) {
    let arg = argv[i];
    if (!arg.startsWith("--")) {
      unknown.push(arg);
      continue;
    }
    if (BOOL_FLAGS.has(arg)) {
      flags.add(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    let val;
    if (eq !== -1) {
      val = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    } else {
      val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        unknown.push(arg);
        continue;
      }
      i++;
    }
    values[arg.slice(2)] = val;
  }

  return { flags, values, unknown };
}

function requestedSections(flags, values) {
  if (flags.has("--help") || flags.has("-h")) return null;

  const fromFlags = [...flags]
    .filter(f => SECTION_ALIASES[f.slice(2)])
    .map(f => SECTION_ALIASES[f.slice(2)]);

  let sections = fromFlags;

  if (sections.length === 0) {
    const envFetch = (process.env.ED_FETCH || "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .map(s => SECTION_ALIASES[s])
      .filter(Boolean);
    if (envFetch.length > 0) sections = envFetch;
  }

  if (sections.length === 0) {
    if (values["download"]) {
      sections = ["download"];
    } else {
      sections = ["cdt", "notes", "messages", "message", "cloud"];
      if (process.env.ED_INCLUDE_SESSION === "1") sections.push("session");
    }
  }

  if (values["download"]) sections.push("download");

  return [...new Set(sections)];
}

function helpText() {
  return `Usage: node index.js [options]

Sections demandées (seul ce qui est demandé est affiché):
  --edt | --timetable      emploi du temps (--start-date / --end-date obligatoires)
  --cdt | --cahier-de-texte
                           cahier de texte
  --notes                  notes
  --messages               liste des messages
  --message                message précis (--message-id)
  --cloud                  cloud (fichiers; essaie plusieurs types d'entité)
  --session                session exportée
  --download <type>:<id>   télécharge un fichier (ex: --download PIECE_JOINTE:9780)
                           types: CLOUD, PIECE_JOINTE, FICHIER_CDT, FICHIER_MENU_RESTAURATION…
                           (cible --download si présent, seule section exécutée sinon)

Sans aucun flag, toutes les sections ci-dessus sauf --session --download sont affichées
(ou celles de \$ED_FETCH: liste séparée par virgules).

Options (flag ou variable d'environnement équivalente):
  --message-id  <id>        ED_MESSAGE_ID     (défaut: 11780)
  --message-mode <mode>     ED_MESSAGE_MODE   (destinataire | expediteur)
  --annee-messages <YYYY-YYYY>  ED_ANNEE_MESSAGES (défaut: 2025-2026)
  --messages-limit <n>      ED_MESSAGES_LIMIT (défaut: 100)
  --start-date <YYYY-MM-DD> ED_START_DATE     (requis pour --edt)
  --end-date <YYYY-MM-DD>   ED_END_DATE       (requis pour --edt)
  --cloud-type <W|E>        ED_CLOUD_TYPE     (défaut: W, essaie l'autre en secours)
  --cloud-depth <n>         ED_CLOUD_DEPTH    (défaut: 100)
  --cloud-id <id>           ED_CLOUD_ID       (id d'entité du cloud, défaut: premier compte élève)
  --cloud-folder <chemin>   ED_CLOUD_FOLDER   (dossier relatif, ex: \\Français\OE1)
  --download-name <nom>     ED_DOWNLOAD_NAME  (fichier de sortie, défaut: <id>)
  --download-year <YYYY-YYYY> ED_DOWNLOAD_YEAR (pièce jointe archivée)

Authentification:
  ED_USER / ED_PASS (obligatoires)
  ED_QCM_CHOICE     réponse QCM (sinon prompt interactif)

Exemples:
  node index.js --cloud
  node index.js --notes --messages
  node index.js --message --message-id=28882
  node index.js --download PIECE_JOINTE:9780 --download-name BACpro-1eres-CIEL.jpg
  node index.js --edt --start-date=2026-09-07 --end-date=2026-09-13
`;
}

async function resolveQcmChoice(qcm) {
  const envChoice = process.env.ED_QCM_CHOICE;
  if (envChoice) {
    const idx = Number(envChoice) - 1;
    const choice =
      !Number.isNaN(idx) && qcm.rawPropositions[idx]
        ? qcm.rawPropositions[idx]
        : qcm.rawPropositions.includes(envChoice)
        ? envChoice
        : qcm.rawPropositions[qcm.propositions.findIndex(v => v === envChoice)];

    if (!choice) {
      throw new Error("ED_QCM_CHOICE invalide.");
    }
    return choice;
  }

  console.log(`QCM: ${qcm.question}`);
  qcm.propositions.forEach((p, i) => console.log(`${i + 1}. ${p}`));

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Choix (numéro): ");
    const idx = Number(answer.trim()) - 1;
    if (Number.isNaN(idx) || !qcm.rawPropositions[idx]) {
      throw new Error("Choix QCM invalide.");
    }
    return qcm.rawPropositions[idx];
  } finally {
    rl.close();
  }
}

async function main() {
  const { flags, values, unknown } = parseArgs(process.argv);

  const sections = requestedSections(flags, values);
  if (sections === null) {
    console.log(helpText());
    return;
  }

  if (unknown.length > 0) {
    throw new Error(`Argument(s) inconnu(s): ${unknown.join(", ")}\n\n${helpText()}`);
  }

  const ED_USER = process.env.ED_USER;
  const ED_PASS = process.env.ED_PASS;
  if (!ED_USER || !ED_PASS) {
    throw new Error("Définis ED_USER et ED_PASS.");
  }

  const config = {
    messageId: values["message-id"] ?? process.env.ED_MESSAGE_ID ?? "11780",
    messageMode: values["message-mode"] ?? process.env.ED_MESSAGE_MODE ?? "destinataire",
    anneeMessages: values["annee-messages"] ?? process.env.ED_ANNEE_MESSAGES ?? "2025-2026",
    messageLimit: Number(values["messages-limit"] ?? process.env.ED_MESSAGES_LIMIT) || 100,
    startDate: values["start-date"] ?? process.env.ED_START_DATE,
    endDate: values["end-date"] ?? process.env.ED_END_DATE,
    cloudType: values["cloud-type"] ?? process.env.ED_CLOUD_TYPE ?? "W",
    cloudDepth: Number(values["cloud-depth"] ?? process.env.ED_CLOUD_DEPTH) || 100,
    cloudId: values["cloud-id"] ?? process.env.ED_CLOUD_ID ?? "",
    cloudFolder: values["cloud-folder"] ?? process.env.ED_CLOUD_FOLDER ?? "",
    download: values["download"] ?? "",
    downloadName: values["download-name"] ?? process.env.ED_DOWNLOAD_NAME,
    downloadYear: values["download-year"] ?? process.env.ED_DOWNLOAD_YEAR ?? ""
  };

  const [downloadType, downloadId] = config.download
    ? config.download.includes(":")
      ? config.download.split(":")
      : ["CLOUD", config.download]
    : [null, null];

  if (sections.includes("edt") && (!config.startDate || !config.endDate)) {
    throw new Error("--edt nécessite --start-date et --end-date (ou ED_START_DATE / ED_END_DATE).");
  }

  const api = new EcoleDirecteClient();

  let loginRes = await api.startLogin(ED_USER, ED_PASS);

  if (loginRes.code === 250) {
    const qcm = await api.getQcmChallenge();
    const choice = await resolveQcmChoice(qcm);
    const validation = await api.answerQcm(choice);
    loginRes = await api.completeLoginWithQcm(ED_USER, ED_PASS, validation);
  }

  if (loginRes.code !== 200) {
    console.log(JSON.stringify(loginRes, null, 2));
    return;
  }

  const studentId = loginRes.data.accounts.find(a => a.typeCompte === "E")?.id;
  if (!studentId) {
    throw new Error("Aucun compte élève trouvé.");
  }

  const out = { login: loginRes };

  for (const section of sections) {
    switch (section) {
      case "edt":
        out.edt = await api.fetchTimetable(studentId, config.startDate, config.endDate);
        break;
      case "cdt":
        out.cdt = await api.fetchCahierDeTexte(studentId);
        break;
      case "notes":
        out.notes = await api.fetchNotes(studentId);
        break;
      case "messages":
        out.messages = await api.fetchMessages(studentId, { itemsPerPage: config.messageLimit });
        break;
      case "message":
        out.message = await api.fetchMessage(studentId, config.messageId, config.messageMode, config.anneeMessages);
        break;
      case "cloud": {
        const alternatives = [...new Set([config.cloudType, config.cloudType === "E" ? "W" : "E"])];
        const entityId = config.cloudId || studentId;
        let cloudErr = null;
        for (const type of alternatives) {
          const res = await api.fetchCloud(entityId, { type, profondeur: config.cloudDepth, folder: config.cloudFolder });
          if (typeof res === "string" && res.includes("<title>")) {
            cloudErr = new Error(`Cloud (${type}) renvoyé une page HTML (chargement/refus).`);
            continue;
          }
          if (res?.code && res.code !== 200) {
            cloudErr = new Error(`Cloud (${type}) refusé (${res.code}).`);
            continue;
          }
          if (type !== config.cloudType) {
            console.error(`[warn] Cloud: type ${config.cloudType} refusé, ${type} utilisé à la place.`);
          }
          out.cloud = res;
          cloudErr = null;
          break;
        }
        if (cloudErr && !out.cloud) throw cloudErr;
        break;
      }
      case "download":
        if (!downloadId) throw new Error("--download nécessite un id (ex: --download PIECE_JOINTE:9780).");
        {
          const result = await api.downloadFile(downloadId, { type: downloadType, year: config.downloadYear });
          const fallbackName = String(downloadId).split("\\").filter(Boolean).pop() || String(downloadId);
          const fileName = config.downloadName || result.filename || fallbackName;
          await writeFile(fileName, result.buffer);
          out.download = { type: downloadType, id: downloadId, savedTo: fileName, size: result.buffer.length };
        }
        break;
      case "session":
        out.session = await api.exportSession();
        break;
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => {
  console.error(err.response?.data ?? err.message ?? err);
  process.exitCode = 1;
});