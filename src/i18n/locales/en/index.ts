/**
 * The English catalog — and the schema every other locale is checked against.
 *
 * Only `errors` is populated. i18n was stood up in Phase 16 for the error
 * surface specifically; the rest of the dashboard is still English literals,
 * and adding a namespace here is what a later phase does per module.
 */

import errors from './errors';

export default { errors };
