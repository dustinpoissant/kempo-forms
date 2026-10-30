/*
  Conditional fields: whether a field is shown depends on the answer to an earlier one.

  This file is copied byte for byte to public/utils/conditions.js, so the browser and the server decide visibility with the same
  code, and a test fails if the two ever differ. It imports nothing and touches nothing but its arguments.

  A condition is { key, operator, value }, and `key` names an earlier field. Conditions are evaluated in form order, so a field
  whose source is itself hidden is hidden too, and chains of any depth resolve with no cycle possible.
*/

export const OPERATORS = ['equals', 'not-equals', 'includes', 'checked', 'not-checked', 'empty', 'not-empty'];

const blank = value => value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);

export const matches = (condition, values) => {
  const actual = values?.[condition.key];
  switch(condition.operator){
    case 'equals': return !Array.isArray(actual) && !blank(actual) && String(actual) === String(condition.value);
    case 'not-equals': return Array.isArray(actual) || blank(actual) || String(actual) !== String(condition.value);
    case 'includes': return Array.isArray(actual) && actual.map(String).includes(String(condition.value));
    case 'checked': return actual === true;
    case 'not-checked': return actual !== true;
    case 'empty': return blank(actual);
    case 'not-empty': return !blank(actual);
    default: return false;
  }
};

/*
  The keys of the fields that are visible given these values. `fields` is the form's ordered field list.
*/
export const visibleKeys = (fields, values) => {
  const visible = new Set();
  for(const field of fields){
    const condition = field.showWhen;
    if(!condition || (visible.has(condition.key) && matches(condition, values))) visible.add(field.key);
  }
  return visible;
};
