import { useMemo, useState } from 'react'
import type { JourneyContext } from './page'

const DAYS=['L','M','X','J','V','S','D']
const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const ymd=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const display=(s:string)=>{const [y,m,d]=s.split('-');return `${d}/${m}/${y}`}

export function MultiCalendar({context}:{context:JourneyContext}){
 const today=new Date(); today.setHours(0,0,0,0)
 const [year,setYear]=useState(today.getFullYear()),[month,setMonth]=useState(today.getMonth())
 const [selected,setSelected]=useState<Set<string>>(()=>new Set())
 const cells=useMemo(()=>{const first=new Date(year,month,1),pad=(first.getDay()+6)%7,count=new Date(year,month+1,0).getDate();const out:(Date|null)[]=[...Array(pad).fill(null),...Array.from({length:count},(_,i)=>new Date(year,month,i+1))];while(out.length%7)out.push(null);return out},[year,month])
 const toggle=(d:Date)=>{if(d<today)return;const key=ymd(d);setSelected(p=>{const n=new Set(p);n.has(key)?n.delete(key):n.add(key);return n})}
 const move=(delta:number)=>{const d=new Date(year,month+delta,1);setYear(d.getFullYear());setMonth(d.getMonth())}
 const continueFlow=()=>{const dates=[...selected].sort();chrome.storage.session.set({renfentDates:dates,renfentJourney:context});window.dispatchEvent(new CustomEvent('renfent:dates-selected',{detail:{dates,context}}))}
 return <section className="renfent-card">
  <header className="renfent-header"><div><strong>Multiformalización</strong><small>Selecciona varias fechas</small></div><span className="renfent-badge">Renfent</span></header>
  <div className="renfent-month"><button type="button" onClick={()=>move(-1)}>‹</button><strong>{MONTHS[month]} {year}</strong><button type="button" onClick={()=>move(1)}>›</button></div>
  <div className="renfent-grid renfent-week">{DAYS.map(d=><span key={d}>{d}</span>)}</div>
  <div className="renfent-grid">{cells.map((d,i)=>d?<button type="button" key={ymd(d)} disabled={d<today} className={selected.has(ymd(d))?'selected':''} onClick={()=>toggle(d)}>{d.getDate()}</button>:<span key={i}/>)}</div>
  {selected.size>0&&<div className="renfent-selection"><div className="renfent-chips">{[...selected].sort().map(d=><span key={d}>{display(d)}</span>)}</div><button className="renfent-primary" type="button" onClick={continueFlow}>Ver trenes para {selected.size} {selected.size===1?'fecha':'fechas'}</button></div>}
 </section>
}
