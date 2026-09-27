import {createTableService} from './service.mjs';
const service=createTableService({database:process.env.TDA_DATABASE||'/var/lib/obr-three-dragon/game.sqlite',origin:process.env.TDA_ORIGIN||'https://obr.dnd.center',maxRooms:Number(process.env.TDA_MAX_ROOMS||20),maxSockets:Number(process.env.TDA_MAX_SOCKETS||180)});
service.server.listen(Number(process.env.PORT||5013),'127.0.0.1',()=>console.log('Three-Dragon service ready'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void service.close().then(()=>process.exit(0)));
