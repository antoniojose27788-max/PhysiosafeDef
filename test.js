const notes = 'Origen: dashboard-chatbot Prioridad inicial: revision_prioritaria Motivo: Lumbar Dolor: Dolor intenso Zona afectada: Lumbar Urgencia percibida: Necesito revision urgente Alertas declaradas: Perdida de control de esfinteres Preferencia de contacto: Email Consentimiento informativo inicial: Acepta admision digital Disponibilidad: Manana';
const keys = ['Origen', 'Prioridad inicial', 'Motivo', 'Zona afectada', 'Dolor', 'Evolucion', 'Urgencia percibida', 'Alertas declaradas', 'Tratamiento previo', 'Seguro\\\\/financiacion', 'Preferencia de contacto', 'Disponibilidad', 'Fecha preferida', 'Hora preferida', 'Consentimiento informativo inicial'].join('|');
const regex = new RegExp('(' + keys + '):\\s*([\\s\\S]*?)(?=(?:' + keys + '):|$)', 'gi');
const result = {};
let match;
while ((match = regex.exec(notes)) !== null) {
  result[match[1].trim().toLowerCase()] = match[2].trim();
}
console.log(result);
