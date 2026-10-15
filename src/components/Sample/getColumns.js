export default ({ formatMessage }) => {
  const statusMap = {
    open: { type: 'success', text: formatMessage({ id: 'SampleStatusOpen' }) },
    closed: { type: 'default', text: formatMessage({ id: 'SampleStatusClosed' }) }
  };

  return [
    { name: 'id', title: 'ID', width: 80, renderType: 'id' },
    { name: 'name', title: formatMessage({ id: 'SampleName' }), width: 160, renderType: 'main' },
    {
      name: 'status',
      title: formatMessage({ id: 'SampleStatus' }),
      width: 100,
      renderType: 'tag',
      getValueOf: item => statusMap[item.status] || { type: 'default', text: item.status }
    },
    { name: 'updatedAt', title: formatMessage({ id: 'SampleUpdatedAt' }), width: 170, format: 'datetime' },
    { name: 'description', title: formatMessage({ id: 'SampleDescription' }), width: 280, renderType: 'description', ellipsis: true }
  ];
};
