import React, { useState, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, Badge, Group, Stack, Text, Title, TextInput, NumberInput, Select, Switch, Tabs, Modal, Accordion, Table, Divider } from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { useReducedMotion } from '@mantine/hooks';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import './ui/tokens.css';
import './ui/styles.css';
import { theme, UiButton, IconButton, Surface, MoneyValue, FinanceCard, ContextEditor, StatusMark, EmptyState } from './ui/index.js';
const colors=['canvas','panel','raised','border-strong','text','muted','accent','positive','danger'];
function Catalog() {
  const [mode,setMode]=useState('dark');
  const [privacy,setPrivacy]=useState(false);
  const [selected,setSelected]=useState('bank');
  const [amount,setAmount]=useState(1200);
  const [period,setPeriod]=useState(null);
  const [modal,setModal]=useState(false);
  const [status,setStatus]=useState('saved');
  const [tab,setTab]=useState('base');
  const reduced=useReducedMotion();
  useLayoutEffect(()=>{document.documentElement.dataset.cfTheme=mode;},[mode]);
  return <MantineProvider theme={theme} forceColorScheme={mode==='light'?'light':'dark'}>
    <main className="cf-lab"><Stack gap="lg">
      <Group justify="space-between" align="flex-start"><Stack gap={4}><Text size="xs" c="dimmed" fw={700}>CASHFLOW / FOUNDATION 0.1</Text><Title order={1}>UI Lab</Title><Text c="dimmed" size="sm">Catalogo di componenti, stati e interazioni. Dati dimostrativi.</Text></Stack><Select label="Tema" data={[{value:'dark',label:'Scuro'},{value:'light',label:'Chiaro'},{value:'contrast',label:'Alto contrasto'}]} value={mode} onChange={v=>v&&setMode(v)} allowDeselect={false}/></Group>
      <Divider label="01 / Foundations" />
      <Surface><Group gap="md">{colors.map(c=><Group key={c} gap={8}><span className="cf-swatch" style={{background:'var(--cf-'+c+')'}}/><Text size="xs">{c}</Text></Group>)}</Group><Text mt="md" size="sm">Noto Sans · Noto Sans Mono · Spazi 4/8/16/24/32 · Radius 4 · Motion 120/180/240 ms</Text><Text size="xs" c="dimmed">Movimento ridotto: {reduced?'attivo':'non attivo'}</Text></Surface>
      <Divider label="02 / Primitives & patterns" />
      <div className="cf-lab-grid">
        <Surface><Stack gap="sm"><Title order={3}>Azioni</Title><Group><UiButton variant="filled" onClick={()=>setAmount(a=>typeof a==='number'?a+100:100)}>+ 100 €</UiButton><UiButton onClick={()=>setModal(true)}>Apri dialogo</UiButton><UiButton disabled>Disabilitato</UiButton><IconButton label="Aggiungi importo" onClick={()=>setAmount(a=>typeof a==='number'?a+100:100)}>+</IconButton></Group><Switch label="Nascondi importi" checked={privacy} onChange={e=>setPrivacy(e.currentTarget.checked)}/><Group><StatusMark state={status}/><Select aria-label="Stato salvataggio" data={['saved','saving','error']} value={status} onChange={v=>v&&setStatus(v)} allowDeselect={false}/></Group></Stack></Surface>
        <Surface><Stack gap="sm"><Title order={3}>Editor</Title><TextInput label="Nome" placeholder="Nome elemento" defaultValue="Conto principale"/>{privacy?<Text size="sm">Importo nascosto</Text>:<NumberInput label="Importo in EUR" value={amount} onChange={setAmount} decimalScale={2} decimalSeparator="," suffix=" €"/>}<Select label="Frequenza" data={['Mensile','Annuale','Una tantum']} defaultValue="Mensile"/><MonthPickerInput label="Mese simulazione" placeholder="Seleziona mese" value={period} onChange={setPeriod} clearable/></Stack></Surface>
        <Surface><Stack gap="sm"><Title order={3}>Navigazione</Title><Tabs value={tab} onChange={v=>v&&setTab(v)}><Tabs.List><Tabs.Tab value="base">Base</Tabs.Tab><Tabs.Tab value="alt">Alternativo</Tabs.Tab></Tabs.List><Tabs.Panel value="base" pt="sm"><Text size="sm">Scenario base</Text></Tabs.Panel><Tabs.Panel value="alt" pt="sm"><Text size="sm">Scenario alternativo</Text></Tabs.Panel></Tabs><Accordion><Accordion.Item value="account"><Accordion.Control>Conto principale</Accordion.Control><Accordion.Panel>Entrate e uscite collegate</Accordion.Panel></Accordion.Item></Accordion><ContextEditor label="Editor contestuale"><Text size="sm">Ancorato al controllo con flip/shift.</Text><TextInput label="Etichetta" placeholder="Modifica nome"/></ContextEditor></Stack></Surface>
        <Surface><Stack gap="sm"><Title order={3}>Feedback</Title><EmptyState title="Nessun movimento" description="Aggiungi un elemento per iniziare." action={<UiButton onClick={()=>setModal(true)}>Aggiungi</UiButton>}/><Group><Badge variant="outline">Demo</Badge><StatusMark state="error"/></Group></Stack></Surface>
      </div>
      <Divider label="03 / Cashflow domain patterns" />
      <Surface><Stack gap="md"><Title order={3}>Nodi e valori</Title><div className="cf-board-demo"><div className="cf-node-grid">{[{id:'bank',name:'Conto principale',value:typeof amount==='number'?amount:NaN},{id:'source',name:'Stipendio',value:1800},{id:'expense',name:'Affitto',value:-650},{id:'deposit',name:'Deposito',value:2400}].map(n=><FinanceCard key={n.id} name={n.name} kind={n.id} value={n.value} privacy={privacy} selected={selected===n.id} onSelect={()=>setSelected(n.id)}/>)}</div></div><Table><Table.Thead><Table.Tr><Table.Th>Movimento</Table.Th><Table.Th>Valore</Table.Th></Table.Tr></Table.Thead><Table.Tbody><Table.Tr><Table.Td>Conto principale</Table.Td><Table.Td><MoneyValue value={typeof amount==='number'?amount:NaN} privacy={privacy} animate/></Table.Td></Table.Tr><Table.Tr><Table.Td>Affitto</Table.Td><Table.Td><MoneyValue value={-650} privacy={privacy}/></Table.Td></Table.Tr></Table.Tbody></Table><Text size="xs" c="dimmed">Le card sono dimostrative, non un canvas finanziario funzionante.</Text></Stack></Surface>
    </Stack><Modal opened={modal} onClose={()=>setModal(false)} title="Conferma operazione" transitionProps={{duration:reduced?0:180}}><Stack><Text size="sm">Dialogo dimostrativo. Nessun dato sarà modificato.</Text><Group justify="flex-end"><UiButton onClick={()=>setModal(false)}>Annulla</UiButton><UiButton variant="filled" onClick={()=>setModal(false)}>Conferma</UiButton></Group></Stack></Modal></main>
  </MantineProvider>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Catalog/></React.StrictMode>);
