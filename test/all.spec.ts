import { expect } from 'chai';

import * as release from '../build';

describe('it', () => {
	it('should expose a create method', (done) => {
		expect(release.create).to.be.a('function');
		done();
	});
});
