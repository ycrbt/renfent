export interface JourneyContext {
  passCode: string
  passType: string
  passTitle: string
  locator: string
  originName: string
  originCode: string
  destinationName: string
  destinationCode: string
  minDate?: string
  maxDate?: string
}

function value(name: string): string {
  const input = document.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`)
  return input?.value?.trim() ?? ''
}

function byId(id: string): string {
  return document.getElementById(id) instanceof HTMLInputElement
    ? (document.getElementById(id) as HTMLInputElement).value.trim()
    : ''
}

export function readJourneyContext(): JourneyContext {
  return {
    passCode: value('abono') || value('featuresDataPassesCard.passesCardCode'),
    passType: value('tipoAbono') || value('featuresDataPassesCard.passesCardType'),
    passTitle: value('descLong') || value('featuresDataPassesCard.passesCardTitle'),
    locator: value('localiza') || value('featuresDataPassesCard.locCode'),
    originName: value('featuresDataPassesCard.originStation.descEstacion'),
    originCode: value('featuresDataPassesCard.originStation.cdgoEstacion'),
    destinationName: value('featuresDataPassesCard.destinStation.descEstacion'),
    destinationCode: value('featuresDataPassesCard.destinStation.cdgoEstacion'),
    minDate: byId('fecha1') || undefined,
  }
}

export function findCalendarMount(): HTMLElement | null {
  const fecha = document.getElementById('fecha1')
  return fecha?.closest('.input-block') ?? fecha?.parentElement ?? null
}

export function hideNativeMultiControls(): void {
  const nativeMulti = document.getElementById('formalizationMulti')
  const block = nativeMulti?.closest('.checkbox-block')
  if (block instanceof HTMLElement) block.style.display = 'none'
}
