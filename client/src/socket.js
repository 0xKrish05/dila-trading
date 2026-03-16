import { io } from "socket.io-client";

const URL = import.meta.env.PROD
  ? window.location.origin
  : "http://localhost:5000";

const socket = io(URL, { transports: ["websocket"] });
export default socket;
