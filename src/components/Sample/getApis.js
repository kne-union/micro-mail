const sampleList = [
  {
    id: 1,
    name: '示例 A',
    description: '这是模版内置的占位数据，不含业务逻辑',
    status: 'open',
    updatedAt: '2025-01-01 10:00:00'
  },
  {
    id: 2,
    name: '示例 B',
    description: '请使用 create-biz 创建真实业务模块',
    status: 'open',
    updatedAt: '2025-02-01 11:00:00'
  },
  {
    id: 3,
    name: '示例 C',
    description: 'API 为前端 mock，不依赖后端业务接口',
    status: 'closed',
    updatedAt: '2025-03-01 12:00:00'
  }
];

let nextId = 4;

export default () => ({
  list: {
    loader: () =>
      Promise.resolve({
        pageData: [...sampleList],
        totalCount: sampleList.length
      })
  },
  create: ({ formData }) => ({
    loader: () => {
      const item = {
        id: nextId++,
        ...formData,
        status: 'open',
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
      };
      sampleList.unshift(item);
      return Promise.resolve({ code: 0, data: item });
    }
  }),
  save: ({ formData, data }) => ({
    loader: () => {
      const index = sampleList.findIndex(item => item.id === data.id);
      if (index > -1) {
        sampleList[index] = {
          ...sampleList[index],
          ...formData,
          updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
        };
        return Promise.resolve({ code: 0, data: sampleList[index] });
      }
      return Promise.resolve({ code: 0, data: { ...formData, id: data.id } });
    }
  }),
  remove: ({ data }) => ({
    loader: () => {
      const index = sampleList.findIndex(item => item.id === data.id);
      if (index > -1) {
        sampleList.splice(index, 1);
      }
      return Promise.resolve({ code: 0, data: { id: data.id } });
    }
  }),
  setStatus: ({ data }) => ({
    loader: () => {
      const index = sampleList.findIndex(item => item.id === data.id);
      if (index > -1) {
        sampleList[index] = {
          ...sampleList[index],
          status: sampleList[index].status === 'open' ? 'closed' : 'open',
          updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
        };
      }
      return Promise.resolve({ code: 0, data: sampleList[index] });
    }
  })
});
