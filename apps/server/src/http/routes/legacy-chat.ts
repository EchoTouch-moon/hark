/** Identify legacy generated messages whose provenance or completion is unsafe.
 * They remain in storage; they must not be replayed into chat or model context.
 */
export function isUnsafeLegacyMessage(message: { id: string; role: string; adapter: string }): boolean {
  if (message.role !== 'assistant' || message.adapter !== 'mock') return false;
  return message.id.startsWith('proactive-') || /^progress-\d+$/.test(message.id) || /^result-\d+$/.test(message.id);
}
