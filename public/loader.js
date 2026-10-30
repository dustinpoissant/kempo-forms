/* Loads the form component on pages that have a form in them, so a page only needs `<k-forms-form slug="...">`. */
if(document.querySelector('k-forms-form')) import('/forms/components/Form.js');
