import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { AuthProvider } from "../contexts/AuthContext";
import { UpdateWatcher } from "../components/UpdateWatcher";
import { AppRouter } from "./router";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

export function App(){return <QueryClientProvider client={queryClient}><HashRouter><AuthProvider><UpdateWatcher/><AppRouter/></AuthProvider></HashRouter></QueryClientProvider>}
