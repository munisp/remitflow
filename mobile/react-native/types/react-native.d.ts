/**
 * TYPE-LEVEL SHIM for the `react-native` package — NOT a runtime mock.
 *
 * mobile/react-native does not install the react-native package (the shipping
 * app with full RN tooling lives in uis/react-native). These declarations
 * mirror the real react-native public API surface that src/ code consumes,
 * so `tsc --noEmit` can check our code's internal consistency. If a real
 * react-native install is added to this tree, delete this file.
 */
declare module "react-native" {
  import * as React from "react";

  // Matches react-native's real StyleProp: arrays may contain falsy entries
  // (conditional styles like `cond && styles.x` compile to false).
  export type Falsy = undefined | null | false;
  export type StyleProp<T> = T | Falsy | ReadonlyArray<T | Falsy>;

  // Matches react-native's DimensionValue.
  export type DimensionValue = number | "auto" | `${number}%`;

  export interface ViewStyle {
    flex?: number;
    flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
    flexShrink?: number;
    justifyContent?:
      | "flex-start"
      | "flex-end"
      | "center"
      | "space-between"
      | "space-around"
      | "space-evenly";
    alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
    alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderBottomWidth?: number;
    borderBottomColor?: string;
    borderRadius?: number;
    padding?: DimensionValue;
    paddingVertical?: DimensionValue;
    paddingHorizontal?: DimensionValue;
    paddingLeft?: DimensionValue;
    paddingRight?: DimensionValue;
    margin?: DimensionValue;
    marginTop?: DimensionValue;
    marginBottom?: DimensionValue;
    marginLeft?: DimensionValue;
    marginRight?: DimensionValue;
    gap?: DimensionValue;
    width?: DimensionValue;
    height?: DimensionValue;
    opacity?: number;
  }

  export interface TextStyle extends ViewStyle {
    color?: string;
    fontSize?: number;
    fontWeight?:
      | "normal"
      | "bold"
      | "100"
      | "200"
      | "300"
      | "400"
      | "500"
      | "600"
      | "700"
      | "800"
      | "900";
  }

  export interface ViewProps {
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
  }

  export interface TextProps {
    style?: StyleProp<TextStyle>;
    numberOfLines?: number;
    children?: React.ReactNode;
  }

  export interface TouchableOpacityProps {
    style?: StyleProp<ViewStyle>;
    onPress?: () => void;
    disabled?: boolean;
    children?: React.ReactNode;
  }

  export interface TextInputProps {
    style?: StyleProp<TextStyle>;
    value?: string;
    onChangeText?: (text: string) => void;
    placeholder?: string;
    keyboardType?: "default" | "numeric" | "email-address" | "phone-pad";
    autoCapitalize?: "none" | "sentences" | "words" | "characters";
    secureTextEntry?: boolean;
  }

  export interface ScrollViewProps {
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    horizontal?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    showsVerticalScrollIndicator?: boolean;
    refreshControl?: React.ReactElement;
    children?: React.ReactNode;
  }

  export interface RefreshControlProps {
    refreshing: boolean;
    onRefresh?: () => void;
    colors?: string[];
    tintColor?: string;
  }

  export interface ActivityIndicatorProps {
    size?: "small" | "large" | number;
    color?: string;
    animating?: boolean;
  }

  export const View: React.ComponentType<ViewProps>;
  export const Text: React.ComponentType<TextProps>;
  export const TextInput: React.ComponentType<TextInputProps>;
  export const TouchableOpacity: React.ComponentType<TouchableOpacityProps>;
  export const ScrollView: React.ComponentType<ScrollViewProps>;
  export const RefreshControl: React.ComponentType<RefreshControlProps>;
  export const ActivityIndicator: React.ComponentType<ActivityIndicatorProps>;

  export type NamedStyles<T> = {
    [P in keyof T]: ViewStyle | TextStyle;
  };

  export const StyleSheet: {
    create<T extends NamedStyles<T>>(styles: T): T;
    absoluteFillObject: ViewStyle;
  };

  export const Alert: {
    alert(title: string, message?: string): void;
  };

  export type AppStateStatus = "active" | "background" | "inactive" | "unknown" | "extension";
  export interface NativeEventSubscription {
    remove(): void;
  }

  export const AppState: {
    currentState: AppStateStatus;
    addEventListener(
      type: "change" | "memoryWarning" | "blur" | "focus",
      listener: (state: AppStateStatus) => void,
    ): NativeEventSubscription;
  };

  export interface LinkingStatic {
    canOpenURL(url: string): Promise<boolean>;
    openURL(url: string): Promise<void>;
    getInitialURL(): Promise<string | null>;
    addEventListener(
      type: "url",
      listener: (event: { url: string }) => void,
    ): NativeEventSubscription;
  }
  export const Linking: LinkingStatic;
}
