// src/constants/documentTypes.js
//
// The 11 identification-document types from the DIAN standard catalog
// (see claude/propuesta-enum-tipo-documento-dian-2026-11-01.md), backed
// server-side by the IdentificationDocumentType enum. Same pattern as
// taxRegimes.js: only the values live here, DOCUMENT_TYPE_LABELS is the
// single bilingual source of truth for the text shown in any <select> or
// table cell -- never duplicate a label inline.
//
// Order matches the DIAN numeric code order (11, 12, 13, 21, 22, 31, 41,
// 42, 47, 48, 50), not alphabetical -- CC and NIT (the two most common in
// practice) are not first, but keeping DIAN's own order avoids yet
// another ad-hoc ranking to maintain.
export const DOCUMENT_TYPES = [
  "RC", "TI", "CC", "TE", "CE", "NIT", "PP", "DIE", "PEP", "PPT", "NIT_EXT",
];

export const DOCUMENT_TYPE_LABELS = {
  es: {
    RC: "Registro Civil",
    TI: "Tarjeta de Identidad",
    CC: "Cédula de Ciudadanía",
    TE: "Tarjeta de Extranjería",
    CE: "Cédula de Extranjería",
    NIT: "NIT",
    PP: "Pasaporte",
    DIE: "Documento de Identificación Extranjero",
    PEP: "Permiso Especial de Permanencia",
    PPT: "Permiso por Protección Temporal",
    NIT_EXT: "NIT del Exterior",
  },
  en: {
    RC: "Civil Registry",
    TI: "Identity Card (Minor)",
    CC: "National ID (Cédula)",
    TE: "Foreigner ID Card",
    CE: "Foreigner ID (Cédula)",
    NIT: "NIT (Tax ID)",
    PP: "Passport",
    DIE: "Foreign Identification Document",
    PEP: "Special Stay Permit",
    PPT: "Temporary Protection Permit",
    NIT_EXT: "Foreign NIT",
  },
};
