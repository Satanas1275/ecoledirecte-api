import { EcoleDirecteClient } from "./edapi-client.js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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
  const ED_USER = process.env.ED_USER;
  const ED_PASS = process.env.ED_PASS;
  if (!ED_USER || !ED_PASS) {
    throw new Error("Définis ED_USER et ED_PASS.");
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
    console.log(loginRes);
    return;
  }

  const studentId = loginRes.data.accounts.find(a => a.typeCompte === "E")?.id;
  if (!studentId) {
    throw new Error("Aucun compte élève trouvé.");
  }

  const cdt = await api.fetchCahierDeTexte(studentId);
  const notes = await api.fetchNotes(studentId);
  const messages = await api.fetchMessages(studentId, { itemsPerPage: 10 });
  const message = await api.fetchMessage(studentId, 11780);
  const session = process.env.ED_INCLUDE_SESSION === "1" ? await api.exportSession() : undefined;

  console.log(JSON.stringify({ login: loginRes, cdt, notes, messages, message, session }, null, 2));
}

main().catch(err => {
  console.error(err.response?.data ?? err.message ?? err);
  process.exitCode = 1;
});
