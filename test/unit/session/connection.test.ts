import * as net from 'net';
import { Connection, ConnectionState } from '../../../src/session/connection';

describe('Connection', () => {
  let connection: Connection;
  let server: net.Server;
  let serverPort: number;

  beforeEach((done) => {
    connection = new Connection();
    // Create a local TCP server for testing
    server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      serverPort = addr.port;
      done();
    });
  });

  afterEach((done) => {
    connection.dispose();
    server.close(done);
  });

  it('should start in Disconnected state', () => {
    expect(connection.state).toBe(ConnectionState.Disconnected);
    expect(connection.isConnected).toBe(false);
  });

  it('should connect to a TCP server', (done) => {
    server.once('connection', () => {
      // server received connection
    });

    connection.on('stateChange', (state: ConnectionState) => {
      if (state === ConnectionState.Connected) {
        expect(connection.isConnected).toBe(true);
        done();
      }
    });

    connection.connect({
      host: '127.0.0.1',
      port: serverPort,
      tls: false,
      tlsVerify: false,
    });
  });

  it('should transition through Connecting state', (done) => {
    const states: ConnectionState[] = [];

    connection.on('stateChange', (state: ConnectionState) => {
      states.push(state);
      if (state === ConnectionState.Connected) {
        expect(states).toContain(ConnectionState.Connecting);
        done();
      }
    });

    connection.connect({
      host: '127.0.0.1',
      port: serverPort,
      tls: false,
      tlsVerify: false,
    });
  });

  it('should receive data from server', (done) => {
    const testData = Buffer.from([0xFF, 0xFD, 0x18]); // IAC DO TERMINAL-TYPE

    server.once('connection', (socket) => {
      socket.write(testData);
    });

    connection.on('stateChange', (state: ConnectionState) => {
      if (state === ConnectionState.Connected) {
        // wait for data
      }
    });

    connection.on('data', (data: Buffer) => {
      expect(Buffer.compare(data, testData)).toBe(0);
      done();
    });

    connection.connect({
      host: '127.0.0.1',
      port: serverPort,
      tls: false,
      tlsVerify: false,
    });
  });

  it('should send data to server', (done) => {
    const testData = Buffer.from([0xFF, 0xFB, 0x18]); // IAC WILL TERMINAL-TYPE

    server.once('connection', (socket) => {
      socket.once('data', (data) => {
        expect(Buffer.compare(data, testData)).toBe(0);
        done();
      });
    });

    connection.on('stateChange', (state: ConnectionState) => {
      if (state === ConnectionState.Connected) {
        connection.send(testData);
      }
    });

    connection.connect({
      host: '127.0.0.1',
      port: serverPort,
      tls: false,
      tlsVerify: false,
    });
  });

  it('should disconnect cleanly', (done) => {
    connection.on('stateChange', (state: ConnectionState) => {
      if (state === ConnectionState.Connected) {
        connection.disconnect();
      }
      if (state === ConnectionState.Disconnected && connection.isConnected === false) {
        // We get Disconnected twice: initial + after disconnect
        done();
      }
    });

    connection.connect({
      host: '127.0.0.1',
      port: serverPort,
      tls: false,
      tlsVerify: false,
    });
  });

  it('should emit error for refused connections', (done) => {
    connection.on('error', (err: Error) => {
      expect(err).toBeDefined();
      done();
    });

    connection.connect({
      host: '127.0.0.1',
      port: 1, // port 1 should refuse
      tls: false,
      tlsVerify: false,
    });
  });

  it('should return false when sending while disconnected', () => {
    expect(connection.send(Buffer.from([0x00]))).toBe(false);
  });

  it('should reconnect using previous config', (done) => {
    let connectCount = 0;

    connection.on('stateChange', (state: ConnectionState) => {
      if (state === ConnectionState.Connected) {
        connectCount++;
        if (connectCount === 1) {
          connection.reconnect();
        } else if (connectCount === 2) {
          expect(connectCount).toBe(2);
          done();
        }
      }
    });

    connection.connect({
      host: '127.0.0.1',
      port: serverPort,
      tls: false,
      tlsVerify: false,
    });
  });

  it('should throw when reconnecting without prior config', () => {
    expect(() => connection.reconnect()).toThrow('No previous connection configuration');
  });

  it('should handle connection timeout', (done) => {
    // Create a server that never accepts
    const silentServer = net.createServer();
    silentServer.listen(0, '127.0.0.1', () => {
      const addr = silentServer.address() as net.AddressInfo;

      // Close the server so connections hang
      silentServer.close();

      connection.on('error', () => {
        // Either timeout or connection refused — both are valid
        done();
      });

      connection.connect({
        host: '192.0.2.1', // TEST-NET, should timeout
        port: addr.port,
        tls: false,
        tlsVerify: false,
        connectTimeout: 500,
      });
    });
  }, 5000);

  it('should emit close when server disconnects', (done) => {
    server.once('connection', (socket) => {
      // Server immediately closes
      socket.destroy();
    });

    connection.on('close', () => {
      expect(connection.state).toBe(ConnectionState.Disconnected);
      done();
    });

    connection.connect({
      host: '127.0.0.1',
      port: serverPort,
      tls: false,
      tlsVerify: false,
    });
  });
});
