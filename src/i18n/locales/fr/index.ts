/**
 * The French catalog.
 *
 * Checked structurally against English as a `DeepPartial`, so anything not
 * translated yet falls back key by key rather than failing the build or
 * leaking a dot-path into the UI.
 */

import type { DeepPartial } from '../../types';
import type { Messages } from '../../catalogs';
import errors from './errors';

const fr: DeepPartial<Messages> = { errors };

export default fr;
