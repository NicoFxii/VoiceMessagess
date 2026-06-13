import { React } from "@vendetta/metro/common";
import { findByProps, findByDisplayName } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

import {
    pickAudioFile,
    sendAudioAsVoiceMessage,
    useVoiceRecorder,
    getAudioMeta,
    DEFAULT_WAVEFORM,
} from "./utils";

const { useState, useEffect } = React;
const RN = require("react-native");
const { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } = RN;

// Módulos de UI de Discord
const Button         = findByProps("looks", "Colors", "Sizes")?.default ?? findByDisplayName("Button");
const Toasts         = findByProps("open", "close", "ToastPosition");
const FormSection    = findByProps("FormSection")?.FormSection ?? findByDisplayName("FormSection");

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        padding: 16,
        gap: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: "700",
        color: "#ffffff",
        marginBottom: 8,
    },
    row: {
        flexDirection: "row",
        gap: 10,
        flexWrap: "wrap",
    },
    btn: {
        flex: 1,
        minWidth: 120,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    btnPrimary: {
        backgroundColor: "#5865F2",
    },
    btnDanger: {
        backgroundColor: "#ED4245",
    },
    btnSuccess: {
        backgroundColor: "#3BA55C",
    },
    btnDisabled: {
        backgroundColor: "#4f545c",
        opacity: 0.5,
    },
    btnText: {
        color: "#ffffff",
        fontWeight: "600",
        fontSize: 14,
    },
    previewBox: {
        backgroundColor: "#2f3136",
        borderRadius: 8,
        padding: 12,
        marginTop: 8,
    },
    previewLabel: {
        color: "#b9bbbe",
        fontSize: 12,
        marginBottom: 4,
    },
    previewFile: {
        color: "#ffffff",
        fontSize: 14,
        fontWeight: "600",
    },
    recordingDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: "#ED4245",
        marginRight: 6,
    },
    recordingRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 4,
    },
    recordingText: {
        color: "#ED4245",
        fontSize: 12,
        fontWeight: "600",
    },
    meta: {
        color: "#72767d",
        fontSize: 11,
        marginTop: 4,
    },
    sendRow: {
        marginTop: 16,
    },
    sendBtn: {
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#5865F2",
    },
    sendBtnDisabled: {
        backgroundColor: "#4f545c",
        opacity: 0.5,
    },
    sendText: {
        color: "#ffffff",
        fontWeight: "700",
        fontSize: 15,
    },
    divider: {
        height: 1,
        backgroundColor: "#40444b",
        marginVertical: 12,
    },
    loading: {
        marginTop: 8,
    },
});

// ─── Timer ────────────────────────────────────────────────────────────────────

function useTimer(active: boolean) {
    const [ms, setMs] = useState(0);
    useEffect(() => {
        if (!active) { setMs(0); return; }
        const id = setInterval(() => setMs(m => m + 1000), 1000);
        return () => clearInterval(id);
    }, [active]);
    const secs = Math.floor(ms / 1000);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function VoiceMessageModal({
    channelId,
    onClose,
}: {
    channelId: string;
    onClose: () => void;
}) {
    const [audioUri, setAudioUri]   = useState<string | null>(null);
    const [filename, setFilename]   = useState<string>("voice-message.ogg");
    const [sending, setSending]     = useState(false);
    const [duration, setDuration]   = useState<number | null>(null);
    const timer = useTimer(false); // solo para mostrar mientras graba

    const { recording, startRecording, stopRecording } = useVoiceRecorder((uri) => {
        setAudioUri(uri);
        setFilename("voice-message.ogg");
        // Calcular duración del blob grabado
        getAudioMeta(uri).then(m => setDuration(m.duration)).catch(() => {});
    });

    const timerDisplay = useTimer(recording);

    async function handleUpload() {
        const file = await pickAudioFile();
        if (!file) return;
        setAudioUri(file.uri);
        setFilename(file.name);
        setDuration(null);
        getAudioMeta(file.uri).then(m => setDuration(m.duration)).catch(() => {});
    }

    async function handleSend() {
        if (!audioUri) return;
        setSending(true);
        try {
            await sendAudioAsVoiceMessage(channelId, audioUri, filename);
            showToast("Voice message enviado ✓", getAssetIDByName("ic_check_circle_24px"));
            onClose();
        } catch (e: any) {
            console.error("[AudioAsVoice]", e);
            showToast(`Error: ${e?.message ?? e}`, getAssetIDByName("ic_warning_24px"));
        } finally {
            setSending(false);
        }
    }

    const durationLabel = duration != null
        ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
        : "calculando...";

    return (
        <View style={styles.container}>
            <Text style={styles.title}>🎙️ Voice Message</Text>

            {/* Botones de acción */}
            <View style={styles.row}>
                {/* Grabar */}
                <TouchableOpacity
                    style={[styles.btn, recording ? styles.btnDanger : styles.btnPrimary]}
                    onPress={recording ? stopRecording : startRecording}
                    disabled={sending}
                >
                    <Text style={styles.btnText}>
                        {recording ? "⏹ Parar" : "🎙 Grabar"}
                    </Text>
                </TouchableOpacity>

                {/* Subir archivo */}
                <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary, (recording || sending) && styles.btnDisabled]}
                    onPress={handleUpload}
                    disabled={recording || sending}
                >
                    <Text style={styles.btnText}>📁 Subir archivo</Text>
                </TouchableOpacity>
            </View>

            {/* Indicador de grabación */}
            {recording && (
                <View style={styles.recordingRow}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingText}>GRABANDO {timerDisplay}</Text>
                </View>
            )}

            {/* Preview del archivo seleccionado */}
            {audioUri && !recording && (
                <>
                    <View style={styles.divider} />
                    <View style={styles.previewBox}>
                        <Text style={styles.previewLabel}>Archivo listo:</Text>
                        <Text style={styles.previewFile} numberOfLines={1}>{filename}</Text>
                        {duration != null
                            ? <Text style={styles.meta}>Duración: {durationLabel}</Text>
                            : <Text style={styles.meta}>Calculando duración...</Text>
                        }
                    </View>

                    {/* Botón enviar */}
                    <View style={styles.sendRow}>
                        <TouchableOpacity
                            style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
                            onPress={handleSend}
                            disabled={sending}
                        >
                            {sending
                                ? <ActivityIndicator color="#fff" />
                                : <Text style={styles.sendText}>Enviar como Voice Message</Text>
                            }
                        </TouchableOpacity>
                    </View>
                </>
            )}
        </View>
    );
}
