/**
 * Manual @lid → phone number seed data.
 * Add entries here for contacts whose @lid cannot be auto-resolved via contacts.set.
 * Format: "lid_value": "phone_number"
 * 
 * To find a @lid: check gateway logs for "[MSG-IN] fromMe=false jid=XXXXX@lid"
 * To find the phone: check the corresponding contact in WA or contacts table.
 */
export const LID_SEED: Record<string, string> = {
  // Format: "numeric_lid_without_@lid_suffix": "phone_number_with_country_code"
  // Example:
  // "115985658962097": "6285113253248",  // bangopal
};
