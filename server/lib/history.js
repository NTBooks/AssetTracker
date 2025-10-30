export function buildRegistrationHistoryText({
  sku,
  serial,
  registrations = [],
  focusedRegistrationId,
  phrase = 'N/A',
  asOf,
}) {
  const timestamp = asOf ? new Date(asOf) : new Date();
  const nowIso = timestamp.toISOString();

  let header = `Proof of Registration\nSKU: ${sku}\nSerial: ${serial}\n`;
  if (focusedRegistrationId !== undefined && focusedRegistrationId !== null) {
    header += `Focused Registration ID: ${focusedRegistrationId}\n`;
  }
  if (phrase !== undefined) {
    header += `Phrase: ${phrase}\n`;
  }

  let chain = 'Registration Chain (oldest → newest)\n';
  if (!registrations.length) {
    chain += '   (no registrations recorded)\n';
  } else {
    registrations.forEach((r, idx) => {
      const marker = focusedRegistrationId !== undefined && focusedRegistrationId !== null && Number(r.id) === Number(focusedRegistrationId) ? '-> ' : '   ';
      const owner = r?.owner_name ? String(r.owner_name) : 'Unknown';
      const createdAt = r?.created_at ? String(r.created_at) : 'Unknown';
      chain += `${marker}[${idx + 1}] Owner: ${owner} • Created At: ${createdAt} (UTC)\n`;
    });
  }

  const disclaimer = `\nNote: This proof reflects data as of ${nowIso} (UTC). If any transfer or change is being considered, generate a fresh proof to ensure the most current state is captured.\n`;
  return `${header}\n${chain}${disclaimer}`;
}
