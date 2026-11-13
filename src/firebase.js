import "./env.js";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

let db = null;
let auth = null;

function readServiceAccount() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (!raw) return null;
  // Acepta el JSON directo o codificado en base64.
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json);
}

try {
  const serviceAccount = readServiceAccount();
  if (serviceAccount) {
    if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
    db.settings({ ignoreUndefinedProperties: true });
    auth = getAuth();
  } else {
    console.warn("[firebase] FIREBASE_SERVICE_ACCOUNT no está configurada. El servidor funciona en modo limitado.");
  }
} catch (err) {
  console.error("[firebase] No se pudo iniciar con la credencial entregada:", err.message);
  db = null;
  auth = null;
}

export const firebaseReady = () => db !== null;
export { FieldValue, Timestamp, auth, db };
