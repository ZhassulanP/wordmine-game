const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function renderScoreboard(players, currentPlayer, labels) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  let rank = 1;
  return `<section class="scoreboard"><table><caption>${escapeHtml(labels.title)}</caption><thead><tr><th scope="col">${escapeHtml(labels.place)}</th><th scope="col">${escapeHtml(labels.player)}</th><th scope="col">${escapeHtml(labels.score)}</th></tr></thead><tbody>${sorted.map((player, index) => {
    if (index === 0 || player.score !== sorted[index - 1].score) rank = index + 1;
    const isYou = player.id === currentPlayer;
    return `<tr class="${isYou ? 'is-you' : ''}"><td>${rank}</td><th scope="row">${escapeHtml(player.name)}${isYou ? ` <span class="muted small">(${escapeHtml(labels.you)})</span>` : ''}</th><td class="score">${player.score}</td></tr>`;
  }).join('')}</tbody></table></section>`;
}
