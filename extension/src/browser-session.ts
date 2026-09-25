import { parseCallback, serialize, type JsValue } from '../../lib/dwr'

const BASE='https://venta.renfe.com'
const pct=(value:string)=>encodeURIComponent(value)

export interface BrowserRequestResult {
  status:number
  url:string
  body:string
}

/**
 * Browser-native replacement for the server Session in lib/renfe.ts.
 * It deliberately never reads or writes the Cookie header: Chromium attaches
 * the authenticated venta.renfe.com session to requests.
 */
export class BrowserSession {
  async request(method:string,url:string,options:{data?:string;referer?:string;contentType?:string}={}):Promise<BrowserRequestResult>{
    const headers:Record<string,string>={}
    if(options.contentType)headers['Content-Type']=options.contentType
    const res=await fetch(url,{
      method,
      headers,
      body:options.data,
      credentials:'include',
      redirect:'follow',
    })
    return {status:res.status,url:res.url,body:await res.text()}
  }

  get(url:string){return this.request('GET',url)}

  async post(url:string,fields:[string,string][]){
    const data=new URLSearchParams(fields).toString()
    return this.request('POST',url,{data,contentType:'application/x-www-form-urlencoded'})
  }

  async dwr(script:string,method:string,params:JsValue[],page:string,batchId:number,scriptSessionId:string):Promise<JsValue>{
    const lines=[
      'callCount=1','windowName=',`c0-scriptName=${script}`,`c0-methodName=${method}`,'c0-id=0',
      ...serialize(params),`batchId=${batchId}`,'instanceId=0',`page=${pct(page)}`,`scriptSessionId=${scriptSessionId}`,''
    ]
    const result=await this.request('POST',`${BASE}/vol/dwr/call/plaincall/${script}.${method}.dwr`,{
      data:lines.join('\n'),
      contentType:'text/plain',
    })
    if(result.status!==200)throw new Error(`${method} returned HTTP ${result.status}`)
    return parseCallback(result.body)
  }
}
