import React from 'react'
import { createRoot } from 'react-dom/client'
import { MultiCalendar } from './calendar'
import { findCalendarMount, hideNativeMultiControls, readJourneyContext } from './page'
import './styles.css'

const ROOT_ID='renfent-extension-root'
function mount(){
 if(document.getElementById(ROOT_ID))return
 const target=findCalendarMount()
 if(!target){console.warn('[Renfent] No se encontró #fecha1');return}
 const context=readJourneyContext(),root=document.createElement('div')
 root.id=ROOT_ID
 target.insertAdjacentElement('afterend',root)
 hideNativeMultiControls()
 createRoot(root).render(<MultiCalendar context={context}/>)
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount()
