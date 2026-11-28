const money = new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR'});
export function formatMoney(value) { return Number.isFinite(value) ? money.format(value) : '—'; }
export function moneyTone(value) { return !Number.isFinite(value) || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative'; }
