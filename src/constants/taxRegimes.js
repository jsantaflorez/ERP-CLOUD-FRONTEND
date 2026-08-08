// Comprehensive translation dictionary for DIAN-COLOMBIA tax regimes
export const TAX_REGIME_LABELS = {
  VAT_REGISTERED:     "Responsable de IVA",
  VAT_NOT_REGISTERED: "No Responsable de IVA",
  GRAND_TAXPAYER:     "Gran Contribuyente",
  SPECIAL_REGIME:     "Régimen Especial",
  INDIVIDUAL:         "Régimen Ordinario - Persona Natural",
  CORPORATE:          "Régimen Ordinario - Persona Jurídica"
};

// Optional: A formatted list, useful if it is necessary to iterate through the selects in other forms.
export const TAX_REGIME_OPTIONS = Object.entries(TAX_REGIME_LABELS).map(([value, label]) => ({
  value,
  label
}));

//Grouping of tax regimes by type of entity (INDIVIDUAL / LEGAL ENTITY)
export const TAX_REGIMES_BY_PERSON = {
  NATURAL: [
    { value: "INDIVIDUAL", label: TAX_REGIME_LABELS.INDIVIDUAL },
    { value: "VAT_NOT_REGISTERED", label: TAX_REGIME_LABELS.VAT_NOT_REGISTERED },
    { value: "VAT_REGISTERED", label: TAX_REGIME_LABELS.VAT_REGISTERED }
  ],
  JURIDICA: [
    { value: "CORPORATE", label: TAX_REGIME_LABELS.CORPORATE },
    { value: "VAT_REGISTERED", label: TAX_REGIME_LABELS.VAT_REGISTERED },
    { value: "SPECIAL_REGIME", label: TAX_REGIME_LABELS.SPECIAL_REGIME },
    { value: "GRAND_TAXPAYER", label: TAX_REGIME_LABELS.GRAND_TAXPAYER }
  ]
};