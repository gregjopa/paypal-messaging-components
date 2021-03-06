/* eslint-disable eslint-comments/disable-enable-pair */
// mutations import here.
/* eslint-disable camelcase */
import gpl_no_amount from './gpl';
import gpl_non_qual from './gplnq';
import gplq from './gplq';

export default function getMutations(id, type) {
    switch (id) {
        case 'GPLQ':
            return gplq[type];
        case 'GPLNQ':
            return gpl_non_qual[type];
        case 'GPL':
        default:
            return gpl_no_amount[type];
    }
}
