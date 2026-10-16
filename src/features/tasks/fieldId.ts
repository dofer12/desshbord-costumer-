/** The id of an input of the card: the id of the card and the name of the field. The card uses it to focus the first field that is wrong. */
export const fieldId = (form: string, name: string) => `${form}-${name}`
