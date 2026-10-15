import { globalInit } from '../preset';
import { getApis } from '@components/Apis';
import merge from 'lodash/merge';

export default async () => {
  const preset = await globalInit();
  return merge({}, preset, {
    apis: merge({}, preset.apis, getApis())
  });
};
