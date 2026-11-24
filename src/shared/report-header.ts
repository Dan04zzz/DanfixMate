import type { LabSettings, ReportHeader } from './types'

/** Intestazione predefinita del report, presa dalle Impostazioni → Laboratorio. */
export const headerFromSettings = (
  lab: Pick<LabSettings, 'name' | 'address' | 'phone' | 'email' | 'vat' | 'technician'>
): ReportHeader => ({
  labName: lab.name,
  address: lab.address,
  phone: lab.phone,
  email: lab.email,
  vat: lab.vat,
  technician: lab.technician
})
