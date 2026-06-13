import { React } from "@vendetta/metro/common";
import { findByProps, findByDisplayName } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Platform } from "react-native";

const { useState, useEffect, useRef } = React;

// ─── Módulos de Discord ───────────────────────────────────────────────────────

const Button          = findByProps("looks", "Colors", "Sizes")?.default ?? findByDisplayName("Button");
const Text            = findByProps("Text", "LegacyText")?.Text ?? findByDisplayName("Text");
const View            = findByProps("absoluteFill")?.default ?? require("react-native").View;
const TouchableOpacity = require("react-native").TouchableOpacity;
const StyleSheet      = require("react-native").StyleSheet;
const Animated        = require("react-native").Animated;

// ─── Constantes ───────────────────────────────────────────────────────────────

export const VOICE_MESSAGE_FLAG = 1 << 13; // 8192
export const DEFAULT_WAVEFORM   = "AAAAAAAAAAAA";
export const WAVEFORM_BINS_PER_SECOND = 10;
export const WAVEFORM_MIN_BINS   = 32;
export const WAVEFORM_MAX_BINS   = 256;
export const WAVEFORM_MAX_VALUE  = 0xFF;

// ─── Waveform real desde AudioBuffer ─────────────────────────────────────────

export function generateWaveform(channelData: Float32Array, duration: number): string {
    const binCount = Math.max(
        WAVEFORM_MIN_BINS,
        Math.min(WAVEFORM_MAX_BINS, Math.floor(duration * WAVEFORM_BINS_PER_SECOND))
    );

    const bins = new Uint8Array(binCount);
    const samplesPerBin = Math.floor(channelData.length / binCount);

    for (let b = 0; b < binCount; b++) {
        let sum = 0;
        for (let s = 0; s < samplesPerBin; s++) {
            const v = channelData[b * samplesPerBin + s];
            sum += v * v;
        }
        bins[b] = Math.floor(Math.sqrt(sum / samplesPerBin) * WAVEFORM_MAX_VALUE);
    }

    const maxBin = Math.max(...bins);
    if (maxBin) {
        const easing = Math.min(1, 100 * (maxBin / WAVEFORM_MAX_VALUE) ** 3);
        const ratio  = 1 + (WAVEFORM_MAX_VALUE / maxBin - 1) * easing;
        for (let i = 0; i < binCount; i++)
            bins[i] = Math.min(WAVEFORM_MAX_VALUE, Math.floor(bins[i] * ratio));
    }

    return btoa(String.fromCharCode(...bins));
}

// ─── Leer audio y generar waveform ───────────────────────────────────────────

export async function getAudioMeta(uri: string): Promise<{ waveform: string; duration: number }> {
    try {
        // Intentar con Web Audio API (disponible en Discord RN via JSC/Hermes bridge)
        const res  = await fetch(uri);
        const buf  = await res.arrayBuffer();
        const ctx  = new (window.AudioContext ?? (window as any).webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(buf);
        ctx.close();

        return {
            waveform: generateWaveform(decoded.getChannelData(0), decoded.duration),
            duration: decoded.duration,
        };
    } catch {
        // Fallback: waveform plano con duración estimada
        return { waveform: DEFAULT_WAVEFORM, duration: 1 };
    }
}

// ─── Subir y enviar como voice message ───────────────────────────────────────

export async function sendAudioAsVoiceMessage(
    channelId: string,
    uri: string,
    filename: string
): Promise<void> {
    const { waveform, duration } = await getAudioMeta(uri);

    // Token — buscar en múltiples lugares para compatibilidad Android + iOS
    const token: string =
        findByProps("getToken")?.getToken?.() ??
        findByProps("token")?.token ??
        findByProps("accessToken")?.accessToken ??
        "";

    if (!token) {
        showToast("No se encontró el token", getAssetIDByName("ic_warning_24px"));
        return;
    }

    // Paso 1: pedir attachment slot
    const slotsRes = await fetch(
        `https://discord.com/api/v9/channels/${channelId}/attachments`,
        {
            method: "POST",
            headers: {
                Authorization: token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                files: [{ filename: "voice-message.ogg", file_size: 0, id: "0" }]
            }),
        }
    );

    if (!slotsRes.ok) throw new Error(`Attachment slot error: ${slotsRes.status}`);
    const { attachments } = await slotsRes.json();
    const slot = attachments[0];

    // Paso 2: subir el archivo al upload URL de Discord
    const fileRes = await fetch(uri);
    const blob    = await fileRes.blob();

    const uploadRes = await fetch(slot.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "audio/ogg" },
        body: blob,
    });

    if (!uploadRes.ok) throw new Error(`Upload error: ${uploadRes.status}`);

    // Paso 3: enviar el mensaje con los flags de voice message
    const SnowflakeUtils = findByProps("fromTimestamp", "extractTimestamp");
    const nonce = SnowflakeUtils?.fromTimestamp?.(Date.now()) ?? String(Date.now());

    const msgRes = await fetch(
        `https://discord.com/api/v9/channels/${channelId}/messages`,
        {
            method: "POST",
            headers: {
                Authorization: token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                flags: VOICE_MESSAGE_FLAG,
                channel_id: channelId,
                content: "",
                nonce,
                sticker_ids: [],
                type: 0,
                attachments: [{
                    id: "0",
                    filename: "voice-message.ogg",
                    uploaded_filename: slot.upload_filename,
                    waveform,
                    duration_secs: duration,
                }],
            }),
        }
    );

    if (!msgRes.ok) {
        const err = await msgRes.json().catch(() => ({}));
        throw new Error(`Message error: ${msgRes.status} - ${JSON.stringify(err)}`);
    }
}

// ─── File Picker compatible Android + iOS ────────────────────────────────────

export async function pickAudioFile(): Promise<{ uri: string; name: string } | null> {
    try {
        if (Platform.OS === "ios") {
            // iOS: react-native-document-picker (ya incluido en Discord)
            const RNDocumentPicker =
                findByProps("pickSingle", "pick", "types") ??
                require("react-native-document-picker");

            const result = await RNDocumentPicker.pickSingle({
                type: [
                    RNDocumentPicker.types?.audio ?? "public.audio",
                ],
            });

            return result ? { uri: result.uri, name: result.name ?? "audio.ogg" } : null;
        } else {
            // Android: expo-document-picker
            const DocumentPicker = (globalThis as any).expo?.modules?.ExpoDocumentPicker
                ?? require("expo-document-picker");

            const result = await DocumentPicker.getDocumentAsync({
                type: "audio/*",
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets?.length) return null;
            const asset = result.assets[0];
            return { uri: asset.uri, name: asset.name ?? "audio.ogg" };
        }
    } catch (e: any) {
        if (e?.code !== "DOCUMENT_PICKER_CANCELED") {
            showToast("Error al abrir archivos", getAssetIDByName("ic_warning_24px"));
        }
        return null;
    }
}

// ─── Grabador de voz con MediaRecorder ───────────────────────────────────────

export function useVoiceRecorder(onBlob: (uri: string) => void) {
    const [recording, setRecording] = useState(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef   = useRef<Blob[]>([]);

    async function startRecording() {
        try {
            const stream = await (navigator.mediaDevices as any).getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            chunksRef.current = [];
            recorderRef.current = recorder;

            recorder.addEventListener("dataavailable", (e: BlobEvent) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            });

            recorder.addEventListener("stop", () => {
                const blob = new Blob(chunksRef.current, { type: "audio/ogg; codecs=opus" });
                const url  = URL.createObjectURL(blob);
                onBlob(url);
                stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
                setRecording(false);
            });

            recorder.start();
            setRecording(true);
        } catch {
            showToast("No se pudo acceder al micrófono", getAssetIDByName("ic_warning_24px"));
        }
    }

    function stopRecording() {
        recorderRef.current?.stop();
    }

    return { recording, startRecording, stopRecording };
}
