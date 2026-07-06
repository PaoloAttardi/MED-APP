export function generateICSString(drugName: string, stockOutDate: Date): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  
  // Format start date as YYYYMMDD
  const yyyy = stockOutDate.getFullYear();
  const mm = String(stockOutDate.getMonth() + 1).padStart(2, '0');
  const dd = String(stockOutDate.getDate()).padStart(2, '0');
  const dtstart = `${yyyy}${mm}${dd}`;
  
  // End date is start date + 1 day (exclusive in RFC 5545 for all-day events)
  const endDate = new Date(stockOutDate);
  endDate.setDate(endDate.getDate() + 1);
  const endYyyy = endDate.getFullYear();
  const endMm = String(endDate.getMonth() + 1).padStart(2, '0');
  const endDd = String(endDate.getDate()).padStart(2, '0');
  const dtend = `${endYyyy}${endMm}${endDd}`;

  const summary = `⚠️ Scorta in esaurimento: ${drugName}`;
  const description = `La scorta di ${drugName} si esaurirà in data odierna (${dd}/${mm}/${yyyy}). Ricordati di rinnovare la prescrizione e fare rifornimento.`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MedTracker//NONSGML Medication Adherence App//IT',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@medtracker.app`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

export function downloadICSFile(drugName: string, stockOutDate: Date): void {
  try {
    const icsContent = generateICSString(drugName, stockOutDate);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    const safeName = drugName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.href = url;
    link.download = `scorta_${safeName}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('ICS generation failed:', error);
    alert('Impossibile creare l\'evento calendario. Controlla le impostazioni del browser.');
  }
}
