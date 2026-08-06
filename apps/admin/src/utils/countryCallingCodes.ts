/** Country calling codes for the internal staff phone number field (Edit user modal). A small
 * embedded list rather than a new runtime dependency (e.g. libphonenumber-js) - this field isn't
 * validated or formatted beyond "digits the operator typed", so a full phone-number library would
 * be more than this internal-only field needs. Sorted by country name. */
export interface CountryCallingCode {
  name: string;
  dialCode: string;
}

export const COUNTRY_CALLING_CODES: readonly CountryCallingCode[] = [
  { name: "Australia", dialCode: "+61" },
  { name: "Austria", dialCode: "+43" },
  { name: "Belgium", dialCode: "+32" },
  { name: "Brazil", dialCode: "+55" },
  { name: "Bulgaria", dialCode: "+359" },
  { name: "Canada", dialCode: "+1" },
  { name: "China", dialCode: "+86" },
  { name: "Croatia", dialCode: "+385" },
  { name: "Cyprus", dialCode: "+357" },
  { name: "Czechia", dialCode: "+420" },
  { name: "Denmark", dialCode: "+45" },
  { name: "Estonia", dialCode: "+372" },
  { name: "Finland", dialCode: "+358" },
  { name: "France", dialCode: "+33" },
  { name: "Germany", dialCode: "+49" },
  { name: "Greece", dialCode: "+30" },
  { name: "Hungary", dialCode: "+36" },
  { name: "Iceland", dialCode: "+354" },
  { name: "India", dialCode: "+91" },
  { name: "Ireland", dialCode: "+353" },
  { name: "Italy", dialCode: "+39" },
  { name: "Japan", dialCode: "+81" },
  { name: "Latvia", dialCode: "+371" },
  { name: "Lithuania", dialCode: "+370" },
  { name: "Luxembourg", dialCode: "+352" },
  { name: "Malta", dialCode: "+356" },
  { name: "Mexico", dialCode: "+52" },
  { name: "Netherlands", dialCode: "+31" },
  { name: "New Zealand", dialCode: "+64" },
  { name: "Norway", dialCode: "+47" },
  { name: "Poland", dialCode: "+48" },
  { name: "Portugal", dialCode: "+351" },
  { name: "Romania", dialCode: "+40" },
  { name: "Slovakia", dialCode: "+421" },
  { name: "Slovenia", dialCode: "+386" },
  { name: "South Korea", dialCode: "+82" },
  { name: "Spain", dialCode: "+34" },
  { name: "Sweden", dialCode: "+46" },
  { name: "Switzerland", dialCode: "+41" },
  { name: "Ukraine", dialCode: "+380" },
  { name: "United Kingdom", dialCode: "+44" },
  { name: "United States", dialCode: "+1" },
];
