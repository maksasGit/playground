FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
USER node
ENV CI=true COREPACK_ENABLE_NETWORK=0 COREPACK_ENABLE_PROJECT_SPEC=0 UV_THREADPOOL_SIZE=2 RAYON_NUM_THREADS=2
CMD ["node", "-e", "setInterval(()=>{},1000)"]
