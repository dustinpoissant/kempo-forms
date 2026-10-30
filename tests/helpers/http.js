/*
  Calls a route's handler the way kempo-server does: a request with its params, query, body, headers and cookies, and a response
  that records what it was told to send. Nothing about the route is replaced; only the network is left out.
*/
export const callRoute = async (handler, { params = {}, query = {}, body = null, headers = {}, cookies = {}, buffer = null } = {}) => {
  const sent = { status: 200, body: undefined, headers: {} };
  const response = {
    status(code){
      sent.status = code;
      return response;
    },
    set(name, value){
      sent.headers[name] = value;
      return response;
    },
    json(data){
      sent.body = data;
      return response;
    },
    send(data){
      sent.body = data;
      return response;
    },
  };
  const request = { params, query, body, headers, cookies, buffer: async () => buffer };
  await handler(request, response);
  return sent;
};
