/**
 * AudioAsVoice — Plugin para Revenge / KettuTweak
 * Agrega un botón de micrófono al toolbar del chat para enviar
 * cualquier archivo de audio (o grabación en vivo) como voice message.
 *
 * Compatible: Android (Revenge) + iOS (KettuTweak)
 */

import { React } from "@vendetta/metro/common";
import { findByProps, findByDisplayName, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";

import { VoiceMessageModal } from "./components/VoiceMessageModal";

const { createElement: h, useState } = React;
const RN = require("react-native");
const { View, TouchableOpacity, StyleSheet, Modal, ScrollView, Pressable } = RN;

// ─── Módulos de Discord ───────────────────────────────────────────────────────

// Icono de micrófono — probar varios nombres que Discord usa según versión
function getMicIcon(): number {
    return (
        getAssetIDByName("ic_microphone_24px") ??
        getAssetIDByName("ic_mic") ??
        getAssetIDByName("ic_voice_activity") ??
        getAssetIDByName("ic_soundboard") ??
        0
    );
}

// Componente de imagen nativo de RN para el icono
const { Image } = RN;

// ─── Estilos del botón ────────────────────────────────────────────────────────

const btnStyles = StyleSheet.create({
    btn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 2,
    },
    icon: {
        width: 22,
        height: 22,
        tintColor: "#b9bbbe",
    },
    iconActive: {
        tintColor: "#5865F2",
    },
    // Overlay del modal
    overlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.6)",
        justifyContent: "flex-end",
    },
    sheet: {
        backgroundColor: "#36393f",
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingBottom: 32,
        maxHeight: "80%",
    },
    sheetHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: "#72767d",
        alignSelf: "center",
        marginTop: 8,
        marginBottom: 4,
    },
});

// ─── Bottom Sheet Modal ───────────────────────────────────────────────────────

function BottomSheet({
    visible,
    onClose,
    channelId,
}: {
    visible: boolean;
    onClose: () => void;
    channelId: string;
}) {
    return h(
        Modal,
        {
            visible,
            transparent: true,
            animationType: "slide",
            onRequestClose: onClose,
        },
        h(
            Pressable,
            { style: btnStyles.overlay, onPress: onClose },
            h(
                Pressable, // inner press no propaga al overlay
                { style: btnStyles.sheet, onPress: () => {} },
                h(View, { style: btnStyles.sheetHandle }),
                h(ScrollView, { keyboardShouldPersistTaps: "handled" },
                    h(VoiceMessageModal, { channelId, onClose })
                )
            )
        )
    );
}

// ─── Botón del toolbar ────────────────────────────────────────────────────────

function AudioVoiceButton({ channelId }: { channelId: string }) {
    const [open, setOpen] = useState(false);
    const icon = getMicIcon();

    return h(
        View,
        null,
        h(
            TouchableOpacity,
            {
                style: btnStyles.btn,
                onPress: () => setOpen(true),
                accessibilityLabel: "Enviar audio como voice message",
            },
            icon
                ? h(Image, {
                    source: icon,
                    style: [btnStyles.icon, open && btnStyles.iconActive],
                  })
                : h(RN.Text, { style: { color: "#b9bbbe", fontSize: 18 } }, "🎙")
        ),
        h(BottomSheet, {
            visible: open,
            onClose: () => setOpen(false),
            channelId,
        })
    );
}

// ─── Patcher — inyectar el botón en el toolbar del chat ──────────────────────

const patches: (() => void)[] = [];

function patchToolbar() {
    // Intentar múltiples nombres que Discord usa para el toolbar de chat
    const candidates = [
        findByProps("ChatInputAttachButton"),
        findByProps("renderChatInputButtons", "isSendButtonHighlighted"),
        findByProps("ChatInputAccessories", "ChatInputActionSheetIcon"),
        findByDisplayName("ChatInputAccessories"),
        findByDisplayName("ChannelTextAreaContainer"),
        findByProps("buttons", "channel", "isSendButtonHighlighted"),
    ].filter(Boolean);

    for (const mod of candidates) {
        // Buscar la función que renderiza los botones
        const key = Object.keys(mod).find(k => {
            const fn = mod[k];
            if (typeof fn !== "function") return false;
            const src = fn.toString();
            return (
                src.includes("chatInput") ||
                src.includes("ChatInput") ||
                src.includes("attach") ||
                src.includes("Attach") ||
                src.includes("buttons")
            );
        });

        if (!key) continue;

        const unpatch = after(key, mod, ([props], ret) => {
            if (!ret) return ret;
            const channelId: string =
                props?.channelId ??
                props?.channel?.id ??
                findByProps("getChannelId")?.getChannelId?.();

            if (!channelId) return ret;

            try {
                // Insertar nuestro botón en los children
                const children = ret.props?.children;
                if (Array.isArray(children)) {
                    children.push(
                        h(AudioVoiceButton, { key: "aav-btn", channelId })
                    );
                } else if (children?.props?.children && Array.isArray(children.props.children)) {
                    children.props.children.push(
                        h(AudioVoiceButton, { key: "aav-btn", channelId })
                    );
                }
            } catch {}

            return ret;
        });

        patches.push(unpatch);
        break; // con uno es suficiente, si no funcionó prueba el siguiente en el array
    }

    // Fallback: parchear el context menu del botón attach (como hace Vencord)
    const ChannelAttach = findByProps("openMediaPicker", "openFilePicker") ??
                          findByProps("channel-attach");

    if (ChannelAttach) {
        const menuKey = Object.keys(ChannelAttach).find(k =>
            typeof ChannelAttach[k] === "function" &&
            ChannelAttach[k].toString().includes("attach")
        );

        if (menuKey) {
            const unpatch = after(menuKey, ChannelAttach, ([props], ret) => {
                const channelId: string =
                    props?.channelId ?? props?.channel?.id;
                if (!channelId || !ret?.props?.children) return ret;

                const children = Array.isArray(ret.props.children)
                    ? ret.props.children
                    : [ret.props.children];

                children.push(
                    h(AudioVoiceButton, { key: "aav-btn", channelId })
                );

                ret.props.children = children;
                return ret;
            });

            patches.push(unpatch);
        }
    }
}

// ─── Export del plugin ────────────────────────────────────────────────────────

export default {
    onLoad() {
        try {
            patchToolbar();
        } catch (e) {
            console.error("[AudioAsVoice] Error en onLoad:", e);
            showToast("[AudioAsVoice] Error al cargar", getAssetIDByName("ic_warning_24px"));
        }
    },

    onUnload() {
        for (const p of patches) {
            try { p(); } catch {}
        }
        patches.length = 0;
    },
};
