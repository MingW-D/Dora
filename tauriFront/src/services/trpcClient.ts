import { createTRPCClient } from '@trpc/client';
import { httpBatchLink } from '@trpc/client/links/httpBatchLink';
import type { AppRouter } from '../apps/routers/index';
import superjson from 'superjson';

// 创建tRPC客户端
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/trpc', // 根据你的服务端端口调整
      transformer: superjson,
    }),
  ],
});

export type { AppRouter };