// Comprehensive translation dictionary for DIAN-COLOMBIA tax regimes
export const TAX_REGIME_LABELS = {
  es: {
    VAT_REGISTERED: "Responsable de IVA",
    VAT_NOT_REGISTERED: "No Responsable de IVA",
    GRAND_TAXPAYER: "Gran Contribuyente",
    SPECIAL_REGIME: "Régimen Tributario Especial",
    INDIVIDUAL: "Régimen Ordinario",
    CORPORATE: "Régimen Ordinario",
  },
  en: {
    VAT_REGISTERED: "VAT Registered",
    VAT_NOT_REGISTERED: "Not VAT Registered",
    GRAND_TAXPAYER: "Large Taxpayer",
    SPECIAL_REGIME: "Special Tax Regime",
    INDIVIDUAL: "Ordinary Regime",
    CORPORATE: "Ordinary Regime",
  },
};

// Which regimes are valid per person type — just the value, no label
// duplicated here. Display text always comes from TAX_REGIME_LABELS
// above (single source of truth), to avoid the same translation drift
// that hit AccountCategory earlier today.
export const TAX_REGIMES_BY_PERSON = {
  NATURAL: ["INDIVIDUAL", "VAT_NOT_REGISTERED", "VAT_REGISTERED"],
  JURIDICA: ["CORPORATE", "VAT_REGISTERED", "SPECIAL_REGIME", "GRAND_TAXPAYER"],
};
