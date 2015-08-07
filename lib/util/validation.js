import { validator } from 'taskcluster-base';

import payloadSchema from '../../schemas/payload';

export async function validateTask(task) {
  return await validator().then((validator) => {
    return validator.check(task.payload, payloadSchema);
  });
}
