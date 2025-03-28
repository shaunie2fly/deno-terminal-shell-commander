import { ShellServer, AuthType } from '../../mod.ts';

// Example usage
const server = new ShellServer({	
    defaultPrompt: 'example>',
    maxConnections: 5,
	port: 8080,
	auth: { type: AuthType.BASIC, users: [{ username: 'user', passwordHash: 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1' },{ username: 'user1', passwordHash: 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1' }] },
});

await server.start();
