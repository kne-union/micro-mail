import { createWithRemoteLoader } from '@kne/remote-loader';

const FormInner = createWithRemoteLoader({
  modules: ['components-core:FormInfo']
})(({ remoteModules, action }) => {
  const [FormInfo] = remoteModules;
  const { Input, TextArea } = FormInfo.fields;

  return (
    <FormInfo
      column={1}
      list={[
        <Input key="name" name="name" label="名称" rule="REQ LEN-2-50" />,
        <TextArea key="description" name="description" label="描述" />
      ]}
    />
  );
});

export default FormInner;
