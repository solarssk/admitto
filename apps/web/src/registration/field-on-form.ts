/**
 * The one rule of a question a guest must answer and the form does not ask. Nobody can satisfy it: a guest never sees
 * it, and every later edit of the attendee that came from the form would be refused for the missing answer (CP-08).
 *
 * Two places apply it and must agree: the save of a field (admin/event-custom-fields-routes.ts, for an event that takes
 * registrations) and the readiness of an event (./readiness.ts, which checks the fields an import left behind before
 * registration is turned on).
 */
export function isRequiredFieldOffForm(field: { required?: boolean; show_on_form: boolean }): boolean {
  return field.required === true && !field.show_on_form;
}
