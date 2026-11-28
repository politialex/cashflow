import { useState } from 'react';
import { useReducedMotion } from '@mantine/hooks';
import { ActionIcon, Button, Paper, Popover, Tooltip, Text, Group, Stack } from '@mantine/core';
import { formatMoney, moneyTone } from './format.js';
export function UiButton({ children, variant = 'default', className = '', ...props }) {
  return <Button variant={variant} className={'cf-action '+(variant==='filled'?'cf-primary ':'')+className} {...props}>{children}</Button>;
}
export function IconButton({ label, children, ...props }) {
  return <Tooltip label={label} openDelay={300}><ActionIcon aria-label={label} variant="default" className="cf-action" {...props}>{children}</ActionIcon></Tooltip>;
}
export function Surface({ children, className = '', ...props }) {
  return <Paper className={'cf-surface '+className} {...props}>{children}</Paper>;
}
export function MoneyValue({ value, privacy = false, animate = false }) {
  if (privacy) return <span className="cf-money cf-private" aria-label="Importo nascosto">••••••</span>;
  return <span key={animate?String(value):'value'} className={'cf-money '+(animate?'cf-value-change':'')} data-tone={moneyTone(value)}>{formatMoney(value)}</span>;
}
export function FinanceCard({ name, kind = 'bank', value, privacy = false, selected = false, onSelect }) {
  return <button type="button" className="cf-finance-card cf-action" data-kind={kind} aria-pressed={selected} onClick={onSelect}>
    <span className="cf-card-label">{name}</span><MoneyValue value={value} privacy={privacy} animate />
    <span className="cf-card-caption">{{bank:'Conto', source:'Entrata', expense:'Spesa', deposit:'Deposito', investment:'Investimento', savings:'Risparmio'}[kind] || 'Elemento'}</span>
  </button>;
}
export function ContextEditor({ label = 'Modifica', children }) {
  const [opened,setOpened] = useState(false);
  const reduced = useReducedMotion();
  return <Popover opened={opened} onChange={setOpened} position="bottom-start" middlewares={{flip:true,shift:true}} trapFocus returnFocus withinPortal withArrow transitionProps={{duration:reduced?0:180,transition:'pop'}}>
    <Popover.Target><UiButton onClick={()=>setOpened(v=>!v)} aria-expanded={opened}>{label}</UiButton></Popover.Target>
    <Popover.Dropdown className="cf-overlay"><Stack gap="xs">{children}<UiButton onClick={()=>setOpened(false)}>Chiudi</UiButton></Stack></Popover.Dropdown>
  </Popover>;
}
export function StatusMark({ state='saved' }) {
  const label={saved:'Salvato',saving:'Salvataggio',error:'Errore'}[state]||'Stato';
  return <Group gap={8} role="status" aria-live="polite"><span className="cf-status-dot" data-status={state} aria-hidden="true"/><Text size="xs">{label}</Text></Group>;
}
export function EmptyState({ title, description, action }) {
  return <Stack align="center" gap="xs" className="cf-empty"><Text fw={600}>{title}</Text><Text size="sm" c="dimmed" ta="center">{description}</Text>{action}</Stack>;
}
