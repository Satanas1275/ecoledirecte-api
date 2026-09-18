import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

const BASE = "https://api.ecoledirecte.com";
const VERSION = "4.95.2";
const ORIGIN = "https://www.ecoledirecte.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export function decodeBase64(value) {
  return Buffer.from(value, "base64").toString("utf8");
}

export function toEdDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formData(payload) {
  return "data=" + JSON.stringify(payload);
}

export class EcoleDirecteClient {
  constructor() {
    this.jar = new CookieJar();
    this.client = wrapper(axios.create({ jar: this.jar }));
    this.state = {
      xToken: "",
      twoFaToken: ""
    };
  }

  resetHttpClient() {
    this.client = wrapper(axios.create({ jar: this.jar }));
  }

  commonHeaders(extra = {}) {
    return {
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
      "User-Agent": USER_AGENT,
      ...extra
    };
  }

  updateTokensFromHeaders(headers) {
    const xToken = headers["x-token"];
    const twoFaToken = headers["2fa-token"];
    if (xToken) this.state.xToken = xToken;
    if (twoFaToken) this.state.twoFaToken = twoFaToken;
  }

  async getGtk() {
    const headers = this.commonHeaders({
      ...(this.state.xToken ? { "X-Token": this.state.xToken } : {}),
      ...(this.state.twoFaToken ? { "2fa-Token": this.state.twoFaToken } : {})
    });

    const res = await this.client.get(`${BASE}/v3/login.awp?gtk=1&v=${VERSION}`, { headers });
    this.updateTokensFromHeaders(res.headers);

    const cookies = await this.jar.getCookies(BASE);
    const gtk = cookies.find(c => c.key === "GTK")?.value;
    if (!gtk) throw new Error("Impossible de récupérer le cookie GTK.");
    return gtk;
  }

  async postLogin(payload, gtk) {
    const res = await this.client.post(`${BASE}/v3/login.awp?v=${VERSION}`, formData(payload), {
      headers: this.commonHeaders({
        "Content-Type": "application/x-www-form-urlencoded",
        "X-GTK": gtk,
        ...(this.state.xToken ? { "X-Token": this.state.xToken } : {}),
        ...(this.state.twoFaToken ? { "2fa-Token": this.state.twoFaToken } : {})
      })
    });
    this.updateTokensFromHeaders(res.headers);
    return res.data;
  }

  async postDoubleAuth(verbe, payload) {
    const res = await this.client.post(
      `${BASE}/v3/connexion/doubleauth.awp?verbe=${verbe}&v=${VERSION}`,
      formData(payload),
      {
        headers: this.commonHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": this.state.xToken,
          "2fa-Token": this.state.twoFaToken
        })
      }
    );
    this.updateTokensFromHeaders(res.headers);
    return res.data;
  }

  async login(identifiant, motdepasse, getQcmChoice) {
    let loginRes = await this.startLogin(identifiant, motdepasse);

    if (loginRes.code === 250) {
      const qcm = await this.getQcmChallenge();
      const choice = await getQcmChoice({
        rawQuestion: qcm.rawQuestion,
        rawPropositions: qcm.rawPropositions,
        question: qcm.question,
        propositions: qcm.propositions
      });

      const validation = await this.answerQcm(choice);
      loginRes = await this.completeLoginWithQcm(identifiant, motdepasse, validation);
    }

    return loginRes;
  }

  async startLogin(identifiant, motdepasse) {
    const firstGtk = await this.getGtk();
    return this.postLogin(
      {
        identifiant,
        motdepasse,
        isReLogin: false,
        uuid: "",
        fa: []
      },
      firstGtk
    );
  }

  async getQcmChallenge() {
    const qcm = await this.postDoubleAuth("get", {});
    const rawQuestion = qcm.data.question;
    const rawPropositions = qcm.data.propositions;
    return {
      rawQuestion,
      rawPropositions,
      question: decodeBase64(rawQuestion),
      propositions: rawPropositions.map(decodeBase64)
    };
  }

  async answerQcm(choice) {
    const validation = await this.postDoubleAuth("post", { choix: choice });
    if (!validation?.data?.cn || !validation?.data?.cv) {
      throw new Error(
        `Validation QCM échouée. Réponse API: ${JSON.stringify(validation)}`
      );
    }
    return validation.data;
  }

  async completeLoginWithQcm(identifiant, motdepasse, qcmValidation) {
    const secondGtk = await this.getGtk();
    return this.postLogin(
      {
        identifiant,
        motdepasse,
        isReLogin: false,
        uuid: "",
        fa: [{ cn: qcmValidation.cn, cv: qcmValidation.cv }]
      },
      secondGtk
    );
  }

  async fetchTimetable(studentId, dateDebut, dateFin) {
    const res = await this.client.post(
      `${BASE}/v3/E/${studentId}/emploidutemps.awp?verbe=get&v=${VERSION}`,
      formData({
        dateDebut,
        dateFin,
        avecTrous: false
      }),
      {
        headers: this.commonHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": this.state.xToken,
          "2fa-Token": this.state.twoFaToken
        })
      }
    );
    this.updateTokensFromHeaders(res.headers);
    return res.data;
  }

  async fetchCahierDeTexte(studentId) {
    const res = await this.client.post(
      `${BASE}/v3/Eleves/${studentId}/cahierdetexte.awp?verbe=get&v=${VERSION}`,
      formData({}),
      {
        headers: this.commonHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": this.state.xToken,
          "2fa-Token": this.state.twoFaToken
        })
      }
    );
    this.updateTokensFromHeaders(res.headers);
    return res.data;
  }

  async fetchNotes(studentId, anneeScolaire = "") {
    const res = await this.client.post(
      `${BASE}/v3/eleves/${studentId}/notes.awp?verbe=get&v=${VERSION}`,
      formData({ anneeScolaire }),
      {
        headers: this.commonHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": this.state.xToken,
          "2fa-Token": this.state.twoFaToken
        })
      }
    );
    this.updateTokensFromHeaders(res.headers);
    return res.data;
  }

  async fetchMessages(
    studentId,
    {
      anneeMessages = "2025-2026",
      typeRecuperation = "received",
      page = 0,
      itemsPerPage = 100,
      getAll = 0,
      force = false,
      idClasseur = 0,
      orderBy = "date",
      order = "desc",
      query = "",
      onlyRead = ""
    } = {}
  ) {
    const params = new URLSearchParams({
      force: String(force),
      typeRecuperation,
      idClasseur: String(idClasseur),
      orderBy,
      order,
      query,
      onlyRead,
      page: String(page),
      itemsPerPage: String(itemsPerPage),
      getAll: String(getAll),
      verbe: "get",
      v: VERSION
    });

    const res = await this.client.post(
      `${BASE}/v3/eleves/${studentId}/messages.awp?${params.toString()}`,
      formData({ anneeMessages }),
      {
        headers: this.commonHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": this.state.xToken,
          "2fa-Token": this.state.twoFaToken
        })
      }
    );
    this.updateTokensFromHeaders(res.headers);
    return res.data;
  }

  async fetchMessage(studentId, messageId, mode = "destinataire", anneeMessages = "2025-2026") {
    const res = await this.client.post(
      `${BASE}/v3/eleves/${studentId}/messages/${messageId}.awp?verbe=get&mode=${mode}&v=${VERSION}`,
      formData({ anneeMessages }),
      {
        headers: this.commonHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": this.state.xToken,
          "2fa-Token": this.state.twoFaToken
        })
      }
    );
    this.updateTokensFromHeaders(res.headers);
    return res.data;
  }

  async fetchCloud(entityId, { type = "W", profondeur = 100, folder = "" } = {}) {
    const qs = [`verbe=get`, `v=${VERSION}`];
    if (folder) qs.push(`idFolder=${folder}`);
    const res = await this.client.post(
      `${BASE}/v3/cloud/${type}/${entityId}.awp?${qs.join("&")}`,
      formData({ profondeur }),
      {
        headers: this.commonHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": this.state.xToken,
          "2fa-Token": this.state.twoFaToken
        })
      }
    );
    this.updateTokensFromHeaders(res.headers);
    return res.data;
  }

  async downloadFile(fileId, { type = "CLOUD", year = "" } = {}) {
    const params = [`verbe=get`, `fichierId=${encodeURIComponent(fileId)}`, `leTypeDeFichier=${type}`];
    if (year) params.push(`anneeMessages=${year}`);
    const res = await this.client.post(
      `${BASE}/v3/telechargement.awp?${params.join("&")}&v=${VERSION}`,
      formData({ forceDownload: 0 }),
      {
        headers: this.commonHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Token": this.state.xToken,
          "2fa-Token": this.state.twoFaToken
        }),
        responseType: "arraybuffer"
      }
    );
    this.updateTokensFromHeaders(res.headers);
    const buffer = Buffer.from(res.data);
    const disposition = res.headers["content-disposition"] ?? "";
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    return { buffer, filename: match?.[1] ?? "" };
  }

  async downloadCloudFile(fileId, options = {}) {
    return this.downloadFile(fileId, options);
  }

  async exportSession() {
    const cookieJar = await this.jar.serialize();
    return {
      xToken: this.state.xToken,
      twoFaToken: this.state.twoFaToken,
      cookieJar
    };
  }

  async importSession(session) {
    if (!session || typeof session !== "object") {
      throw new Error("Session invalide.");
    }

    if (session.cookieJar) {
      this.jar = await CookieJar.deserialize(session.cookieJar);
      this.resetHttpClient();
    }

    this.state.xToken = session.xToken ?? "";
    this.state.twoFaToken = session.twoFaToken ?? "";
  }
}
